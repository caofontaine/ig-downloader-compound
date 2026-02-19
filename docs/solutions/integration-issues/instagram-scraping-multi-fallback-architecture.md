---
title: "Instagram Post Downloader - Multi-Fallback Scraping Implementation"
date: 2026-02-19
category: "integration-issues"
severity: "low"
tags:
  - "feature"
  - "instagram-scraping"
  - "multi-fallback-strategy"
  - "media-download"
  - "cdn-optimization"
  - "nextjs"
  - "typescript"
components:
  - "lib/instagram.ts"
  - "lib/media.ts"
  - "lib/types.ts"
  - "app/api/preview/route.ts"
  - "app/api/download/route.ts"
  - "app/api/proxy/route.ts"
  - "app/page.tsx"
  - "components/url-input.tsx"
  - "components/media-preview.tsx"
  - "components/download-buttons.tsx"
symptoms: |
  Downloading Instagram media at full resolution requires inspecting network requests or using third-party sites riddled with ads. No clean, local tool exists that fetches the highest quality media from a single URL paste.
root_cause: |
  Instagram does not provide a public API for downloading media content. The platform uses multiple data endpoints and response formats that vary by request method and parameters. CDN URLs require manipulation via undocumented `stp` parameters for higher resolution. Instagram periodically changes response structures, requiring a cascading fallback strategy.
resolution_type: "feature"
time_to_resolve: "4-6 hours"
related_issues: []
---

# Instagram Post Downloader - Multi-Fallback Scraping Implementation

## Problem

Downloading Instagram media (photos, videos, carousels) at full resolution requires either inspecting network requests manually or using third-party websites cluttered with ads and trackers. There is no clean, self-hosted tool that takes a single Instagram post URL and delivers the highest-quality media files with a simple preview-and-download workflow.

## Investigation Steps

The brainstorm document (`docs/brainstorms/2026-02-19-ig-downloader-brainstorm.md`) evaluated several approaches:

- **External API services** were rejected because they introduce third-party dependencies, cost money, or require API keys.
- **Instagram's official Graph API** was rejected because it requires app registration, OAuth tokens, and only works for posts on accounts the authenticated user manages.
- **GraphQL private API with `doc_id` / `X-IG-App-ID`** was considered but rejected because these endpoint identifiers rotate frequently and require reverse-engineering Instagram's client JavaScript after each update.
- **Direct HTML/JSON scraping with multi-fallback** was chosen because it requires zero authentication, zero API keys, and zero configuration. By cascading through multiple extraction methods, the approach is resilient to Instagram disabling any single data path. A proven reference implementation (`caofontaine/ig-downloader`) validated this strategy.

Next.js was chosen as the framework because it unifies the React UI and the server-side API routes in a single project, eliminating the need to manage separate services for a personal-use tool.

## Root Cause / Core Challenge

Three core technical challenges drive the implementation complexity:

1. **Instagram scraping without authentication.** Instagram serves post data through multiple channels (JSON API endpoints, embedded `<script>` JSON, embed pages, OG meta tags), and any single channel can be disabled or restructured at any time. A robust solution must cascade through all available channels.

2. **CDN URL manipulation for maximum quality.** Instagram CDN URLs contain a `stp` parameter that constrains image dimensions (e.g., `stp=dst-jpg_e35_p1080x1080`). The server-reported "display resources" often cap at lower resolutions than the CDN actually stores. Removing or expanding the size constraint in `stp` can yield higher-resolution images, but the upgraded URL must be probed to confirm the CDN actually serves it.

3. **Handling multiple JSON response shapes.** Instagram returns media data in at least seven different JSON structures depending on which endpoint responds and which internal version is active (`graphql.shortcode_media`, `data.shortcode_media`, `gql_data.shortcode_media`, `context.media`, `items[0]`, `props.pageProps.data.shortcode_media`, `props.pageProps.graphql.shortcode_media`). Carousel data can appear as either `edge_sidecar_to_children.edges[]` (GraphQL) or `carousel_media[]` (API), and image candidates can be keyed as `display_resources`, `display_candidates`, or `image_versions2.candidates` with different field names for width/height.

## Solution

### 1. Multi-Fallback Scraping Strategy (`lib/instagram.ts`)

The `fetchPostMedia()` function cascades through four independent extraction strategies, returning as soon as any strategy yields valid media items:

```typescript
export async function fetchPostMedia(postUrl: string): Promise<ExtractedMedia> {
  const { url, shortcode } = normalizePostUrl(postUrl);

  // Strategy 1: ?__a=1&__d=dis magic parameters
  const json = await tryFetchJson(`${url}?__a=1&__d=dis`);
  if (json) {
    const media = extractShortcodeMedia(json);
    const items = media ? extractFromMediaNode(media) : [];
    if (items.length > 0) { /* ... enrich and return ... */ }
  }

  // Strategy 2: Parse HTML page for embedded JSON
  const html = await fetchHtml(url);
  // ... extract JSON from <script> tags (window._sharedData, __additionalDataLoaded, s.handle())

  // Strategy 3: Parse embed page
  const embedHtml = await fetchHtml(`${url}embed/`);
  // ... same HTML JSON extraction on /embed/ variant

  // Strategy 4: OG meta tags fallback
  const metaFallback = extractMetaMediaFromHtml(html);
  // ... og:image / og:video + legacy /media/?size=l endpoint

  throw new Error("No media found for that post.");
}
```

**Strategy 1** appends `?__a=1&__d=dis` to the post URL, which instructs Instagram to return raw JSON instead of HTML. This is the fastest path and returns the richest data.

**Strategy 2** fetches the full HTML page and uses `cheerio` to extract JSON from three `<script>` tag patterns: `window._sharedData = {...}`, `__additionalDataLoaded({...})`, and `s.handle({...})`. The `s.handle()` case may contain stringified JSON nested inside the outer JSON, requiring recursive extraction via `extractEmbeddedJsonStrings()`.

**Strategy 3** fetches the `/embed/` variant of the post page, which sometimes contains media data in a different HTML structure when the main page does not.

**Strategy 4** falls back to OG meta tags (`og:image`, `og:video`, `og:video:secure_url`) and the legacy `/media/?size=l` redirect endpoint.

### 2. Media Extraction from Multiple JSON Shapes

The `extractShortcodeMedia()` function navigates seven known response shapes:

```typescript
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
```

`extractFromMediaNode()` handles carousels (`edge_sidecar_to_children.edges[]` or `carousel_media[]`), videos (`video_url` with `display_url` as thumbnail), and images (pick largest from `display_resources`/`image_versions2.candidates`). `normalizeCandidates()` maps the varying field names (`src`/`url`, `width`/`config_width`, `height`/`config_height`) into a uniform shape.

### 3. Image URL Promotion via CDN `stp` Parameter (`lib/media.ts`)

`tryUpgradeSize()` manipulates Instagram CDN URLs to request higher resolutions:

1. Parses the `stp` parameter into tokens
2. Finds the size constraint token matching `/^(p|s)\d+x\d+$/`
3. Attempts removing the size constraint entirely and probes the resulting URL
4. If that fails, tries scaling the constraint up by 4/3 and probes again

`probeImageUrl()` validates upgraded URLs with a HEAD request (falling back to a Range request) to confirm the CDN serves a valid image.

### 4. Binary Header Probing for Image Dimensions

`probeImageDimensions()` fetches only the first 4KB via HTTP Range request and parses binary headers:
- **PNG:** Reads dimensions from IHDR chunk (bytes 16-23)
- **JPEG:** Scans for SOF markers (0xC0-0xCF) and reads width/height from the marker payload

This gives accurate post-promotion dimensions without downloading the full image.

### 5. Streaming ZIP for Carousels (`app/api/download/route.ts`)

For carousel posts, the download endpoint streams a ZIP archive using `archiver`, bridging Node.js streams to Web Streams for Next.js route handler compatibility. Files are named `<username>_post_<shortcode>_<index>.<ext>`.

### 6. CORS Proxy (`app/api/proxy/route.ts`)

Instagram CDN URLs cannot be loaded directly in `<img>` tags due to CORS. The proxy validates that URLs belong to allowed CDN domains (`.instagram.com`, `.cdninstagram.com`, `.fbcdn.net`), then streams responses with a 10-minute cache header.

## Key Implementation Details

- **Balanced JSON extraction.** `extractBalancedJson()` uses a brace-counting parser tracking string escapes and nesting depth to extract complete JSON from arbitrary JavaScript, avoiding regex that fails on nested structures.
- **Video dimension inference.** `inferVideoDimensionsFromUrl()` decodes the base64 `efg` parameter, extracts `vencode_tag`, and parses the resolution to infer width, calculating height from the thumbnail aspect ratio.
- **Timestamp normalization.** `findPostTimestamp()` handles both Unix seconds and milliseconds by checking `ts < 1e12`. Post dates are also extracted from meta descriptions and raw HTML.
- **Fetch timeout.** All HTTP requests use a 10-second `AbortController` timeout to prevent hanging on unresponsive endpoints.
- **Custom `UpstreamError` class.** HTTP 401/403 from Instagram are wrapped with user-friendly messages, mapped to HTTP 502 by API routes.
- **No authentication or environment variables.** Zero configuration — no `.env.local`, no tokens, no API keys. All scraping uses only `User-Agent: Mozilla/5.0`.

## Verification

**API-level (curl):** Tested single photos, videos, reels, and carousels against real Instagram URLs. Confirmed structured JSON responses with media URLs, dimensions, and file sizes. Verified download endpoint produces correct `Content-Disposition` headers and valid ZIP archives.

**Browser:** Full end-to-end flow at `localhost:3000` — paste URL, see proxied thumbnails with resolution/size labels, download individual files and carousel ZIPs. All error states (invalid URL, private post, network failure) display clear inline messages.

## Prevention & Maintenance

### Monitoring Fallback Health

Track which extraction strategy succeeds for each request to detect when Instagram breaks older methods:
- If Strategy 1 (JSON API) fails 80%+ but Strategy 2 succeeds, the `?__a=1&__d=dis` endpoint changed
- If Strategies 1-3 all fail but Strategy 4 works, HTML structure has changed fundamentally
- If all strategies fail, Instagram has made a breaking change requiring code updates

### CDN URL Expiration

Instagram CDN URLs expire within 24-48 hours. Downloads should happen promptly after fetching metadata. If a download fails, re-fetch the post. Consider adding a "refresh" action in the UI if the preview is stale.

### Rate Limiting

For personal use (1-10 requests/session from a residential IP), rate limiting is not a concern. If scaling beyond personal use, implement exponential backoff and request throttling with adaptive User-Agent rotation.

## Best Practices

1. **All Instagram fetching through `lib/instagram.ts`** — API routes never call Instagram directly
2. **Silent failure fallthrough** — `tryFetchJson()` returns null on failure, allowing the fallback chain to continue without logging noise
3. **Validate early** — `normalizePostUrl()` runs before any network requests
4. **Defensive property access** — Optional chaining (`?.`) throughout media extraction
5. **Consistent timeouts** — 10-second `AbortController` on all network operations with proper cleanup

## Known Limitations

- **Private accounts:** No authentication mechanism; cannot access private posts
- **Stories and DMs:** Only permanent posts, reels, and TV content
- **CDN domain changes:** Proxy whitelist is hardcoded; new CDN domains require code updates
- **Binary probing:** Only reads first 4KB; depends on JPEG/PNG format (no WebP/AVIF support)
- **Timestamp parsing:** Regex-based; international locale formats fail silently
- **ZIP streaming errors:** If a media URL fails mid-transfer, the entire ZIP may be corrupted

## Related Documentation

- [docs/plans/2026-02-19-feat-instagram-post-downloader-plan.md](../../plans/2026-02-19-feat-instagram-post-downloader-plan.md) — Comprehensive implementation plan with four phases, URL normalization spec, and acceptance criteria
- [docs/plans/2026-02-19-feat-higher-resolution-image-promotion-plan.md](../../plans/2026-02-19-feat-higher-resolution-image-promotion-plan.md) — Enhancement plan for pushing image resolution beyond Instagram's standard 1080px via CDN URL manipulation
- [docs/brainstorms/2026-02-19-ig-downloader-brainstorm.md](../../brainstorms/2026-02-19-ig-downloader-brainstorm.md) — Initial brainstorm establishing the multi-fallback approach and design decisions
- [docs/research/2026-02-19-instagram-scraping-research.md](../../research/2026-02-19-instagram-scraping-research.md) — Comprehensive scraping research covering viable approaches, anti-scraping measures, and response structure reference
- [docs/research/2026-02-19-nextjs-research.md](../../research/2026-02-19-nextjs-research.md) — Next.js v16 architecture research validating Route Handlers, streaming responses, and archiver over JSZip
- [CLAUDE.md](../../../CLAUDE.md) — Project conventions and architectural decisions
- Reference implementation: [`caofontaine/ig-downloader`](https://github.com/caofontaine/ig-downloader) — Proven multi-fallback scraping approach
