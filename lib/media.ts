import type { MediaItem } from "./types";

const FETCH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function enrichMediaItems(items: MediaItem[]): Promise<void> {
  await Promise.all(
    items.map(async (item) => {
      if (item.type === "image") {
        // Pass initial dimensions (from API's node.dimensions) as upgrade target
        const target = item.width && item.height
          ? { width: item.width, height: item.height }
          : undefined;
        item.url = await promoteImageUrl(item.url, target);
        item.thumbnail = item.url;
        const probed = await probeImageDimensions(item.url);
        if (probed) {
          item.width = probed.width;
          item.height = probed.height;
        }
      }
      if (!item.width || !item.height) {
        const inferred = inferDimensionsFromUrl(item.url);
        if (inferred) {
          item.width = inferred.width;
          item.height = inferred.height;
        }
      }
      item.filesize = await fetchFileSize(item.url);
    }),
  );
}

async function fetchFileSize(url: string): Promise<number> {
  try {
    const res = await fetchWithTimeout(url, { method: "HEAD" });
    if (!res.ok) return 0;
    const length = res.headers.get("content-length");
    return length ? Number(length) : 0;
  } catch {
    return 0;
  }
}

async function promoteImageUrl(
  url: string,
  targetDimensions?: { width: number; height: number },
): Promise<string> {
  let current = url;
  if (isInstagramMediaUrl(current)) {
    const resolved = await resolveLegacyImageUrl(current);
    if (resolved) current = resolved;
  }
  const upgraded = await tryUpgradeSize(current, targetDimensions);
  return upgraded ?? current;
}

function isInstagramMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith("instagram.com") && parsed.pathname.includes("/media/");
  } catch {
    return false;
  }
}

async function resolveLegacyImageUrl(url: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.startsWith("image/")) return null;
    if (res.body) {
      try { await res.body.cancel(); } catch { /* ignore */ }
    }
    return res.url || url;
  } catch {
    return null;
  }
}

function parseEfgDimensions(url: string): { width: number; height: number } | null {
  try {
    const parsed = new URL(url);
    const efg = parsed.searchParams.get("efg");
    if (!efg) return null;
    const decoded = Buffer.from(decodeURIComponent(efg), "base64").toString("utf8");
    const payload = JSON.parse(decoded);
    const tag = payload?.vencode_tag;
    if (typeof tag !== "string") return null;
    // Match patterns like "xpids.1200x1600.sdr.C3"
    const match = /\.(\d{3,4})x(\d{3,4})\./.exec(tag);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
  } catch {
    return null;
  }
}

function buildCandidateUrl(
  parsed: URL,
  tokens: string[],
  sizeIndex: number,
  candidate: { w: number; h: number; prefix: string } | "remove",
): string {
  const clone = new URL(parsed.toString());
  if (candidate === "remove") {
    const withoutSize = tokens.filter((_, i) => i !== sizeIndex);
    if (withoutSize.length > 0) {
      clone.searchParams.set("stp", withoutSize.join("_"));
    } else {
      clone.searchParams.delete("stp");
    }
  } else {
    const updated = [...tokens];
    updated[sizeIndex] = `${candidate.prefix}${candidate.w}x${candidate.h}`;
    clone.searchParams.set("stp", updated.join("_"));
  }
  return clone.toString();
}

async function tryUpgradeSize(
  url: string,
  targetDimensions?: { width: number; height: number },
): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const stp = parsed.searchParams.get("stp");
  if (!stp) return null;

  const tokens = stp.split("_");
  const sizeIndex = tokens.findIndex((token) => /^(p|s)\d+x\d+$/.test(token));
  if (sizeIndex === -1) return null;

  const match = /^(p|s)(\d+)x(\d+)$/.exec(tokens[sizeIndex]);
  if (!match) return null;
  const [, prefix, widthRaw, heightRaw] = match;
  const origW = Number(widthRaw);
  const origH = Number(heightRaw);
  if (!origW || !origH) return null;

  // Build candidate sizes: efg dimensions, target dimensions, remove size, tiers, 4/3
  const candidates: Array<{ w: number; h: number; prefix: string } | "remove"> = [];

  // 1. efg-derived dimensions
  const efgDims = parseEfgDimensions(url);
  if (efgDims && efgDims.width > origW) {
    candidates.push({ w: efgDims.width, h: efgDims.height, prefix });
  }

  // 2. API-reported target dimensions
  if (targetDimensions && targetDimensions.width > origW) {
    candidates.push({ w: targetDimensions.width, h: targetDimensions.height, prefix });
  }

  // 3. Remove size token entirely
  candidates.push("remove");

  // 4. Known Instagram tiers (descending)
  const aspect = origH / origW;
  for (const tierW of [1440, 1200]) {
    if (tierW > origW) {
      const tierH = Math.round(tierW * aspect);
      candidates.push({ w: tierW, h: tierH, prefix: "s" });
      if (prefix !== "s") candidates.push({ w: tierW, h: tierH, prefix });
    }
  }

  // 5. 4/3 multiplier
  const w43 = Math.round((origW * 4) / 3);
  const h43 = Math.round((origH * 4) / 3);
  if (w43 > origW) candidates.push({ w: w43, h: h43, prefix });

  // Try each candidate
  for (const candidate of candidates) {
    const probeUrl = buildCandidateUrl(parsed, tokens, sizeIndex, candidate);
    const result = await probeImageUrl(probeUrl);
    if (!result) continue;

    // Verify actual dimensions are better than original
    const dims = await probeImageDimensions(result);
    if (dims && dims.width > origW) return result;
    if (!dims) return result; // can't verify, trust the CDN
  }

  return null;
}

async function probeImageUrl(url: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, { method: "HEAD", headers: { "User-Agent": "Mozilla/5.0" } });
    const contentType = res.headers.get("content-type") ?? "";
    if (res.ok && contentType.startsWith("image/")) return res.url || url;
  } catch { /* try GET fallback */ }

  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0", Range: "bytes=0-0" } });
    const contentType = res.headers.get("content-type") ?? "";
    if (res.ok && contentType.startsWith("image/")) {
      if (res.body) { try { await res.body.cancel(); } catch { /* ignore */ } }
      return res.url || url;
    }
  } catch { /* ignore */ }

  return null;
}

function inferDimensionsFromUrl(url: string): { width: number; height: number } | null {
  try {
    const parsed = new URL(url);
    const stp = parsed.searchParams.get("stp") ?? "";
    const match = /(p|s)(\d+)x(\d+)/.exec(stp);
    if (match) return { width: Number(match[2]), height: Number(match[3]) };
    return null;
  } catch {
    return null;
  }
}

export async function probeImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0", Range: "bytes=0-4095" } });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return parseImageDimensions(buffer);
  } catch {
    return null;
  }
}

function parseImageDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 10) return null;
  return parsePngDimensions(buffer) ?? parseJpegDimensions(buffer);
}

function parsePngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  if (buffer.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  if (buffer.slice(12, 16).toString("ascii") !== "IHDR") return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width && height ? { width, height } : null;
}

function parseJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset++; continue; }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2) break;
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      if (offset + 7 > buffer.length) break;
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      return width && height ? { width, height } : null;
    }
    offset += length;
  }
  return null;
}
