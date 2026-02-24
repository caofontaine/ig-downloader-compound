import { load } from "cheerio";
import type { MediaItem } from "./types";
import { enrichMediaItems } from "./media";
import { decodeEfgTag } from "./instagram-cdn";

export interface ExtractedMedia {
  items: MediaItem[];
  meta: {
    type: "post";
    username?: string;
    shortcode?: string;
    postTimestamp?: number;
  };
}

export class UpstreamError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

const POST_PATH_RE = /\/(p|reel|tv)\/([A-Za-z0-9_-]+)/;
const FETCH_TIMEOUT_MS = 10_000;

export function normalizePostUrl(input: string): { url: string; shortcode: string } {
  const trimmed = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid post URL.");
  }
  if (!parsed.hostname.includes("instagram.com")) {
    throw new Error("Post URL must be from instagram.com.");
  }
  const match = parsed.pathname.match(POST_PATH_RE);
  if (!match) {
    throw new Error("Post URL must include /p/, /reel/, or /tv/ and a shortcode.");
  }
  const [, type, shortcode] = match;
  const url = `https://www.instagram.com/${type}/${shortcode}/`;
  return { url, shortcode };
}

export async function fetchPostMedia(postUrl: string): Promise<ExtractedMedia> {
  const { url, shortcode } = normalizePostUrl(postUrl);

  // Strategy 1: ?__a=1&__d=dis magic parameters
  const json = await tryFetchJson(`${url}?__a=1&__d=dis`);
  if (json) {
    const media = extractShortcodeMedia(json);
    const items = media ? extractFromMediaNode(media) : [];
    if (items.length > 0) {
      const username = findUsername(media);
      const postTimestamp = findPostTimestamp(media);
      await enrichMediaItems(items);
      return { items, meta: { type: "post", username, shortcode, postTimestamp } };
    }
  }

  // Strategy 2: Parse HTML page for embedded JSON
  const html = await fetchHtml(url);
  const postTimestampFromHtml = parsePostDateFromHtml(html);
  const metaInfo = extractMetaInfoFromHtml(html);
  const jsonResult = await extractFromHtmlJson(html, shortcode, metaInfo, postTimestampFromHtml);
  if (jsonResult) return jsonResult;

  // Strategy 3: Parse embed page
  const embedHtml = await fetchHtml(`${url}embed/`);
  const embedMetaInfo = extractMetaInfoFromHtml(embedHtml);
  const embedResult = await extractFromHtmlJson(embedHtml, shortcode, embedMetaInfo, postTimestampFromHtml);
  if (embedResult) return embedResult;

  // Strategy 4: OG meta tags fallback
  const metaFallback = extractMetaMediaFromHtml(html);
  if (metaFallback.items.length > 0) {
    if (metaFallback.items.length === 1 && metaFallback.items[0].type === "image") {
      const legacyUrl = await resolveLegacyImageUrl(url);
      if (legacyUrl) {
        metaFallback.items[0].url = legacyUrl;
        metaFallback.items[0].thumbnail = legacyUrl;
      }
    }
    await enrichMediaItems(metaFallback.items);
    return {
      items: metaFallback.items,
      meta: {
        type: "post",
        username: metaFallback.username,
        shortcode,
        postTimestamp: metaFallback.postTimestamp ?? postTimestampFromHtml,
      },
    };
  }

  throw new Error("No media found for that post.");
}

// --- HTTP helpers ---

async function fetchHtml(url: string): Promise<string> {
  const res = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (res.status === 401 || res.status === 403) {
    throw new UpstreamError("Instagram temporarily blocked this request. Try again later.", res.status);
  }
  if (!res.ok) {
    throw new UpstreamError("Failed to fetch Instagram content.", res.status);
  }
  return await res.text();
}

async function tryFetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// --- Media extraction from JSON ---

/* eslint-disable @typescript-eslint/no-explicit-any */

function extractShortcodeMedia(blob: any): any | null {
  if (blob?.graphql?.shortcode_media) return blob.graphql.shortcode_media;
  if (blob?.data?.shortcode_media) return blob.data.shortcode_media;
  if (blob?.gql_data?.shortcode_media) return blob.gql_data.shortcode_media;
  if (blob?.context?.media) return blob.context.media;
  if (Array.isArray(blob?.items) && blob.items.length > 0) return blob.items[0];
  if (blob?.props?.pageProps?.data?.shortcode_media) return blob.props.pageProps.data.shortcode_media;
  if (blob?.props?.pageProps?.graphql?.shortcode_media) return blob.props.pageProps.graphql.shortcode_media;
  return null;
}

function extractFromMediaNode(node: any): MediaItem[] {
  if (!node || typeof node !== "object") return [];

  // Carousel via GraphQL response
  if (Array.isArray(node.edge_sidecar_to_children?.edges)) {
    return node.edge_sidecar_to_children.edges.flatMap((edge: any) => extractFromMediaNode(edge.node));
  }

  // Carousel via API response
  if (Array.isArray(node.carousel_media)) {
    return node.carousel_media.flatMap((child: any) => extractFromMediaNode(child));
  }

  const isVideo = Boolean(node.is_video) || node.__typename === "GraphVideo" || node.media_type === 2;
  const candidates = normalizeCandidates(
    node.display_resources ?? node.display_candidates ?? node.image_versions2?.candidates ?? []
  );
  const bestImage = pickLargest(candidates);
  const thumbnail = pickSmallest(candidates)?.src ?? node.thumbnail_src ?? node.display_url ?? bestImage?.src ?? "";

  if (isVideo) {
    const videoCandidates = normalizeCandidates(node.video_resources ?? node.video_versions ?? []);
    const bestVideo = pickLargest(videoCandidates);
    const url = bestVideo?.src ?? node.video_url ?? "";
    if (!url) return [];

    const aspectSource =
      bestVideo?.width && bestVideo?.height
        ? bestVideo
        : bestImage?.width && bestImage?.height
          ? bestImage
          : node.dimensions?.width && node.dimensions?.height
            ? node.dimensions
            : null;

    const inferred =
      !bestVideo && aspectSource
        ? inferVideoDimensionsFromUrl(url, { width: aspectSource.width, height: aspectSource.height })
        : null;

    const w = inferred?.width ?? bestVideo?.width ?? bestImage?.width ?? node.dimensions?.width ?? 0;
    const h = inferred?.height ?? bestVideo?.height ?? bestImage?.height ?? node.dimensions?.height ?? 0;

    return [{ type: "video", url, thumbnail, width: w, height: h, filesize: 0 }];
  }

  const url = bestImage?.src ?? node.display_url ?? "";
  if (!url) return [];
  return [{
    type: "image",
    url,
    thumbnail,
    width: bestImage?.width ?? node.dimensions?.width ?? 0,
    height: bestImage?.height ?? node.dimensions?.height ?? 0,
    filesize: 0,
  }];
}

function normalizeCandidates(candidates: any[]): Array<{ src: string; width: number; height: number }> {
  return candidates
    .map((c) => ({
      src: c?.src ?? c?.url ?? "",
      width: c?.width ?? c?.config_width ?? 0,
      height: c?.height ?? c?.config_height ?? 0,
    }))
    .filter((c) => Boolean(c.src));
}

function pickLargest(candidates: Array<{ src: string; width: number; height: number }>) {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, cur) => (cur.width * cur.height > best.width * best.height ? cur : best));
}

function pickSmallest(candidates: Array<{ src: string; width: number; height: number }>) {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, cur) => (cur.width * cur.height < best.width * best.height ? cur : best));
}

// --- HTML JSON extraction ---

function extractJsonFromHtml(html: string): any[] {
  const $ = load(html);
  const scripts = $("script")
    .toArray()
    .map((script) => $(script).html())
    .filter((content): content is string => Boolean(content));

  const results: any[] = [];

  for (const content of scripts) {
    // window._sharedData
    const sharedIndex = content.indexOf("window._sharedData =");
    if (sharedIndex !== -1) {
      const jsonText = extractBalancedJson(content, content.indexOf("{", sharedIndex));
      if (jsonText) {
        const parsed = safeJsonParse(jsonText);
        if (parsed) results.push(parsed);
      }
    }

    // __additionalDataLoaded
    const additionalIndex = content.indexOf("__additionalDataLoaded");
    if (additionalIndex !== -1) {
      const jsonStart = content.indexOf("{", additionalIndex);
      const jsonText = extractBalancedJson(content, jsonStart);
      if (jsonText) {
        const parsed = safeJsonParse(jsonText);
        if (parsed) results.push(parsed);
      }
    }

    // s.handle() server-side JS
    const serverJsIndex = content.indexOf("s.handle(");
    if (serverJsIndex !== -1) {
      const jsonStart = content.indexOf("{", serverJsIndex);
      const jsonText = extractBalancedJson(content, jsonStart);
      if (jsonText) {
        const parsed = safeJsonParse(jsonText);
        if (parsed) {
          results.push(parsed);
          results.push(...extractEmbeddedJsonStrings(parsed));
        }
      }
    }
  }

  return results;
}

function extractEmbeddedJsonStrings(payload: unknown): any[] {
  const results: any[] = [];
  const stack: unknown[] = [payload];

  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node === "string") {
      const trimmed = node.trim();
      if (trimmed.startsWith("{") && (trimmed.includes("shortcode_media") || trimmed.includes("gql_data"))) {
        const parsed = safeJsonParse(trimmed);
        if (parsed) results.push(parsed);
      }
      continue;
    }
    if (Array.isArray(node)) {
      for (const value of node) stack.push(value);
      continue;
    }
    if (node && typeof node === "object") {
      for (const value of Object.values(node)) stack.push(value);
    }
  }

  return results;
}

async function extractFromHtmlJson(
  html: string,
  shortcode: string,
  metaInfo: ReturnType<typeof extractMetaInfoFromHtml>,
  fallbackTimestamp?: number,
): Promise<ExtractedMedia | null> {
  const jsonBlobs = extractJsonFromHtml(html);
  for (const blob of jsonBlobs) {
    const media = extractShortcodeMedia(blob);
    if (!media) continue;
    const items = extractFromMediaNode(media);
    if (items.length === 0) continue;
    const username = findUsername(media) ?? metaInfo.username;
    const postTimestamp = findPostTimestamp(media) ?? metaInfo.postTimestamp ?? fallbackTimestamp;
    await enrichMediaItems(items);
    return { items, meta: { type: "post", username, shortcode, postTimestamp } };
  }
  return null;
}

// --- OG meta tag extraction ---

function extractMetaMediaFromHtml(html: string): {
  items: MediaItem[];
  username?: string;
  postTimestamp?: number;
} {
  const $ = load(html);
  const ogImage = decodeHtmlEntities($('meta[property="og:image"]').attr("content") ?? "");
  const ogVideo =
    decodeHtmlEntities($('meta[property="og:video:secure_url"]').attr("content") ?? "") ||
    decodeHtmlEntities($('meta[property="og:video"]').attr("content") ?? "");
  const metaInfo = extractMetaInfoFromHtml(html);

  if (ogVideo) {
    return {
      items: [{ type: "video", url: ogVideo, thumbnail: ogImage || ogVideo, width: 0, height: 0, filesize: 0 }],
      username: metaInfo.username,
      postTimestamp: metaInfo.postTimestamp,
    };
  }
  if (ogImage) {
    return {
      items: [{ type: "image", url: ogImage, thumbnail: ogImage, width: 0, height: 0, filesize: 0 }],
      username: metaInfo.username,
      postTimestamp: metaInfo.postTimestamp,
    };
  }
  return { items: [], username: metaInfo.username, postTimestamp: metaInfo.postTimestamp };
}

function extractMetaInfoFromHtml(html: string): { username?: string; postTimestamp?: number } {
  const $ = load(html);
  const ogUrl = decodeHtmlEntities($('meta[property="og:url"]').attr("content") ?? "");
  const description = decodeHtmlEntities(
    $('meta[name="description"]').attr("content") ?? $('meta[property="og:description"]').attr("content") ?? "",
  );
  const postTimestamp = parsePostDateFromDescription(description) ?? parsePostDateFromHtml(html);
  return { username: extractUsernameFromOgUrl(ogUrl), postTimestamp };
}

async function resolveLegacyImageUrl(postUrl: string): Promise<string | null> {
  const legacyUrl = postUrl.includes("/media/") ? postUrl : `${postUrl}media/?size=l`;
  try {
    const res = await fetchWithTimeout(legacyUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.startsWith("image/")) return null;
    if (res.body) {
      try { await res.body.cancel(); } catch { /* ignore */ }
    }
    return res.url || legacyUrl;
  } catch {
    return null;
  }
}

// --- Utility helpers ---

function extractUsernameFromOgUrl(value: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && parts[1] === "p") return parts[0];
  } catch { /* ignore */ }
  return undefined;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&amp;/g, "&");
}

function findUsername(media: any): string | undefined {
  return media?.owner?.username ?? media?.user?.username;
}

function findPostTimestamp(media: any): number | undefined {
  const ts = media?.taken_at_timestamp ?? media?.taken_at ?? media?.date;
  if (typeof ts !== "number") return undefined;
  return ts < 1e12 ? ts * 1000 : ts;
}

function parsePostDateFromDescription(value: string): number | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\u00a0/g, " ");
  const match = /on\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/i.exec(normalized);
  if (match) {
    const monthIndex = monthNameToIndex(match[1]);
    if (monthIndex !== null) {
      return Date.UTC(Number(match[3]), monthIndex, Number(match[2]));
    }
  }
  return undefined;
}

function parsePostDateFromHtml(html: string): number | undefined {
  if (!html) return undefined;
  const normalized = html.replace(/\u00a0/g, " ");
  const match = /on\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/i.exec(normalized);
  if (match) {
    const monthIndex = monthNameToIndex(match[1]);
    if (monthIndex !== null) {
      return Date.UTC(Number(match[3]), monthIndex, Number(match[2]));
    }
  }
  return undefined;
}

function monthNameToIndex(value: string): number | null {
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const index = months.indexOf(value.toLowerCase());
  return index >= 0 ? index : null;
}

function extractBalancedJson(source: string, startIndex: number): string | null {
  if (startIndex < 0) return null;
  const openChar = source[startIndex];
  const closeChar = openChar === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escape) { escape = false; }
      else if (char === "\\") { escape = true; }
      else if (char === '"') { inString = false; }
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === openChar) depth++;
    if (char === closeChar) depth--;
    if (depth === 0) return source.slice(startIndex, i + 1);
  }
  return null;
}

function safeJsonParse(text: string): any | null {
  try { return JSON.parse(text); } catch { return null; }
}

function inferVideoDimensionsFromUrl(
  url: string,
  aspect?: { width: number; height: number },
): { width: number; height: number } | null {
  const tag = decodeEfgTag(url);
  if (!tag) return null;
  const match = /C\d\.(\d{3,4})\./.exec(tag);
  if (!match) return null;
  const width = Number(match[1]);
  if (!width || !aspect?.width || !aspect?.height) return null;
  const height = Math.round((width * aspect.height) / aspect.width);
  return height ? { width, height } : null;
}

/* eslint-enable @typescript-eslint/no-explicit-any */
