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
        item.url = await promoteImageUrl(item.url);
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

async function promoteImageUrl(url: string): Promise<string> {
  let current = url;
  if (isInstagramMediaUrl(current)) {
    const resolved = await resolveLegacyImageUrl(current);
    if (resolved) current = resolved;
  }
  const upgraded = await tryUpgradeSize(current);
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

async function tryUpgradeSize(url: string): Promise<string | null> {
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
  const width = Number(widthRaw);
  const height = Number(heightRaw);
  if (!width || !height) return null;

  // Try removing size constraint entirely
  const withoutSize = tokens.filter((_, i) => i !== sizeIndex);
  if (withoutSize.length > 0) {
    parsed.searchParams.set("stp", withoutSize.join("_"));
  } else {
    parsed.searchParams.delete("stp");
  }
  const noSizeCandidate = parsed.toString();
  const noSizeOk = await probeImageUrl(noSizeCandidate);
  if (noSizeOk) return noSizeOk;

  // Try upgrading size by 4/3
  const targetWidth = Math.round((width * 4) / 3);
  const targetHeight = Math.round((height * 4) / 3);
  if (targetWidth <= width) return null;

  const upgradedTokens = [...tokens];
  upgradedTokens[sizeIndex] = `${prefix}${targetWidth}x${targetHeight}`;
  parsed.searchParams.set("stp", upgradedTokens.join("_"));
  return await probeImageUrl(parsed.toString());
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
