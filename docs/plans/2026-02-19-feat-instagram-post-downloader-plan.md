---
title: "feat: Instagram Post Downloader"
type: feat
status: completed
date: 2026-02-19
---

# feat: Instagram Post Downloader

## Overview

A personal-use Next.js web app for downloading Instagram posts and Reels (photos, videos, carousels) from public profiles at the highest quality available. Runs locally on localhost. User pastes a URL, sees a preview of the media, and downloads individual items or a ZIP archive for carousels.

## Problem Statement / Motivation

Downloading Instagram media at full resolution requires inspecting network requests or using third-party sites riddled with ads. A clean, local tool that fetches the highest quality media from a single URL paste would solve this.

## Proposed Solution

A Next.js App Router application with API Route Handlers and a single-page React UI.

**Core architecture:**

```
Browser (React UI)
    |
    v
POST /api/preview      -- accepts URL, scrapes Instagram, returns media metadata
POST /api/download     -- fetches media, returns single file or ZIP archive
GET  /api/proxy        -- proxies media URLs for thumbnail previews (CORS)
```

**Instagram data fetching:** Multi-fallback scraping strategy with **no authentication, no `doc_id`, no `X-IG-App-ID`**. Cascading methods ensure resilience — if one breaks, the next kicks in:

1. `?__a=1&__d=dis` magic parameters (JSON response)
2. HTML page parsing (embedded `<script>` JSON: `window._sharedData`, `__additionalDataLoaded`, `s.handle()`)
3. Embed page parsing (`/embed/` variant)
4. OG meta tag extraction (`og:image`, `og:video`) + legacy `/media/?size=l`

**Reference implementation:** [`caofontaine/ig-downloader`](https://github.com/caofontaine/ig-downloader) — proven working approach using this exact strategy.

## Technical Approach

### Project Structure

```
ig-downloader-compound/
├── app/
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Main UI (single page)
│   └── api/
│       ├── preview/
│       │   └── route.ts        # POST: fetch + parse Instagram post metadata
│       ├── download/
│       │   └── route.ts        # POST: download single file or ZIP bundle
│       └── proxy/
│           └── route.ts        # GET: proxy media URLs for previews
├── components/
│   ├── url-input.tsx           # URL input + fetch button
│   ├── media-preview.tsx       # Preview grid (photos + video thumbnails)
│   └── download-buttons.tsx    # Individual + "Download All" buttons
├── lib/
│   ├── instagram.ts            # Multi-fallback scraping, URL normalization, media extraction
│   ├── media.ts                # Image URL promotion, dimension probing, file size enrichment
│   └── types.ts                # TypeScript interfaces
├── package.json
├── tsconfig.json
├── next.config.ts
└── CLAUDE.md
```

Note: No `.env.local` needed — no configurable tokens or API keys.

### Implementation Phases

#### Phase 1: Project Setup + Instagram Scraping

**Goal:** Scaffold Next.js project and get Instagram data fetching working via multi-fallback scraping.

**Tasks:**

- [x] Initialize Next.js project with TypeScript, Tailwind CSS (`npx create-next-app@latest`)
- [x] Install dependencies: `cheerio` (HTML parsing), `archiver` (streaming ZIP)
- [x] Create `lib/types.ts`:

```typescript
// lib/types.ts
export type MediaType = "image" | "video";

export interface MediaItem {
  type: MediaType;
  url: string;        // highest quality media URL
  thumbnail: string;  // preview thumbnail URL
  width: number;
  height: number;
  filesize: number;
}

export interface ApiResponse {
  status: "ok" | "error";
  items: MediaItem[];
  error: string | null;
  meta?: {
    type: "post";
    username?: string;
    shortcode?: string;
    postTimestamp?: number;
  };
}
```

- [x] Create `lib/instagram.ts` — the core scraping module, referencing `caofontaine/ig-downloader` `apps/api/src/instagram.ts`:
  - `normalizePostUrl(input: string)` — parse and validate URL, extract shortcode from `/p/`, `/reel/`, `/tv/` paths, strip query params
  - `fetchPostMedia(postUrl: string)` — multi-fallback fetcher:
    1. Try `?__a=1&__d=dis` JSON endpoint (no special headers, just `User-Agent`)
    2. Try HTML page parsing with `cheerio` — extract JSON from `<script>` tags
    3. Try embed page (`/embed/`) with same HTML parsing
    4. Fall back to OG meta tags + legacy media URL
  - `extractShortcodeMedia(blob)` — navigate multiple response shapes (`graphql.shortcode_media`, `data.shortcode_media`, `gql_data.shortcode_media`, `items[0]`, etc.)
  - `extractFromMediaNode(node)` — normalize media data from any response shape:
    - Carousel: `edge_sidecar_to_children.edges[]` or `carousel_media[]`
    - Video: extract `video_url`, use `display_url` as thumbnail
    - Image: pick largest from `display_resources` / `image_versions2.candidates`
- [x] Create `lib/media.ts` — media quality utilities:
  - `promoteImageUrl(url)` — try to upgrade image resolution by manipulating CDN `stp` parameter (remove size constraints)
  - `probeImageDimensions(url)` — fetch first 4KB, parse JPEG/PNG headers for actual width/height
  - `fetchFileSize(url)` — HEAD request to get Content-Length
  - `enrichFileSizes(items)` — enrich all media items with promoted URLs, dimensions, and file sizes
- [x] Create `app/api/preview/route.ts` (POST handler):
  - Accept `{ url: string }` in request body
  - Validate with `normalizePostUrl()`, call `fetchPostMedia()`
  - Return `ApiResponse` with media items and metadata
- [x] Test with `curl` against real Instagram post URLs (single photo, single video, carousel, reel)

**Success criteria:** `curl -X POST http://localhost:3000/api/preview -H 'Content-Type: application/json' -d '{"url":"https://instagram.com/p/REAL_CODE/"}'` returns structured media metadata with file sizes and dimensions.

#### Phase 2: Download + Proxy Routes

**Goal:** Enable downloading media and proxying thumbnails through the server.

**Tasks:**

- [x] Create `app/api/proxy/route.ts` (GET handler):
  - Accept `?url=<encoded_cdn_url>` query param
  - Validate URL is Instagram/Facebook CDN (`*.cdninstagram.com`, `*.fbcdn.net`, `*.instagram.com`)
  - Stream response body through to client
  - Set `Cache-Control: public, max-age=600` for preview caching

- [x] Create `app/api/download/route.ts` (POST handler):
  - Accept `{ url: string }` in request body (same as preview)
  - Re-fetch or use cached media data
  - **Single item:** Stream media file with `Content-Disposition: attachment; filename="<name>"`
  - **Multiple items (carousel):** Stream ZIP archive using `archiver`:
    - Fetch each media URL sequentially, pipe into archive
    - Set `Content-Type: application/zip`
    - Set `Content-Disposition: attachment; filename="<username>_post_<shortcode>.zip"`
  - File naming: `<username>_post_<shortcode>_<index>.<ext>` (e.g., `johndoe_post_ABC123_1.jpg`)
  - Single file naming: `<username>_<datetime>.<ext>`

**Success criteria:** Can download individual media files and ZIP archives via curl.

#### Phase 3: React UI

**Goal:** Build the single-page interface.

**Tasks:**

- [x] Create `app/page.tsx` — main page layout with centered content
- [x] Create `components/url-input.tsx`:
  - Text input field with placeholder "https://www.instagram.com/p/..."
  - "Get preview" button (triggers POST /api/preview)
  - Client-side URL validation (must match `instagram.com/(p|reel|tv)/` pattern)
  - Loading spinner while fetching
  - Error messages displayed inline
- [x] Create `components/media-preview.tsx`:
  - Grid layout showing all media items
  - Photos: display via `/api/proxy?url=...` to avoid CORS
  - Videos: display thumbnail with "Video" badge overlay
  - Show resolution and file size per item
  - Show username and media count
- [x] Create `components/download-buttons.tsx`:
  - "Download file" button for single items (triggers POST /api/download)
  - "Download zip" button for carousels (triggers POST /api/download, which auto-bundles)
  - Loading state while downloading
- [x] Wire up state management (React useState):
  - States: `idle` | `fetching` | `ready` | `error` | `downloading`
  - On new fetch, clear previous results

**Success criteria:** Full flow works in browser — paste URL, click fetch, see previews with thumbnails, download files.

#### Phase 4: Error Handling + Polish

**Goal:** Handle all error cases gracefully.

**Tasks:**

- [x] URL validation errors: "Enter a valid Instagram post URL"
- [x] Private/unavailable post: "This post is private or unavailable"
- [x] Instagram blocked request (401/403): "Instagram temporarily blocked this request. Try again later."
- [x] No media found (all fallbacks failed): "No media found for that post."
- [x] Network errors: "Could not reach Instagram. Check your connection."
- [x] Download failures: "Download failed. Try again."
- [x] Create CLAUDE.md documenting project conventions
- [x] Initialize git repo with `.gitignore` (node_modules, .next)

**Success criteria:** Every error scenario shows a clear, actionable message. No unhandled errors crash the UI.

## URL Normalization Specification

The `normalizePostUrl()` function must handle:

| Input | Normalized URL | Shortcode |
|---|---|---|
| `https://www.instagram.com/p/ABC123/` | `https://www.instagram.com/p/ABC123/` | `ABC123` |
| `https://instagram.com/p/ABC123/` | `https://www.instagram.com/p/ABC123/` | `ABC123` |
| `https://www.instagram.com/reel/ABC123/` | `https://www.instagram.com/reel/ABC123/` | `ABC123` |
| `https://www.instagram.com/tv/ABC123/` | `https://www.instagram.com/tv/ABC123/` | `ABC123` |
| `https://www.instagram.com/p/ABC123/?igsh=xyz` | `https://www.instagram.com/p/ABC123/` | `ABC123` |
| `https://www.instagram.com/p/ABC123` (no trailing slash) | `https://www.instagram.com/p/ABC123/` | `ABC123` |
| `https://example.com/something` | Error: not instagram.com | — |
| `not a url` | Error: invalid URL | — |

Regex for path matching: `/(p|reel|tv)/([A-Za-z0-9_-]+)/`

## Scraping Fallback Strategy

```
fetchPostMedia(url)
    │
    ├─ 1. GET url?__a=1&__d=dis → try JSON parse → extract shortcode_media
    │      (No special headers. Just User-Agent: Mozilla/5.0)
    │
    ├─ 2. GET url → HTML → cheerio parse <script> tags:
    │      • window._sharedData = {...}
    │      • __additionalDataLoaded({...})
    │      • s.handle({...}) → may contain stringified JSON with gql_data
    │
    ├─ 3. GET url/embed/ → same HTML parsing as step 2
    │
    └─ 4. GET url → og:image / og:video meta tags
           + GET url/media/?size=l (legacy image endpoint)
```

Each step returns immediately if it finds valid media. Steps only execute if prior steps returned nothing.

## Technical Considerations

- **No tokens or keys needed:** Unlike the GraphQL API approach, this method requires no `doc_id`, `X-IG-App-ID`, or authentication. No `.env.local` configuration for Instagram access.
- **Anti-scraping:** For personal use (1-10 requests/session from residential IP), Instagram's rate limiting is not a concern. Use a realistic `User-Agent: Mozilla/5.0` header.
- **CDN URL expiration:** Instagram CDN URLs expire. Downloads should happen promptly after fetching metadata. If a download fails, re-fetch the post.
- **Image quality promotion:** Manipulate CDN URL `stp` parameter to request higher resolution. Probe actual dimensions from image headers (first 4KB). See reference implementation's `promoteImageUrl()` and `tryUpgradeSize()`.
- **ZIP streaming:** Use `archiver` to stream ZIP files as they're built (not buffered in memory). Better than JSZip for large carousels.
- **Fallback resilience:** The multi-step approach means if Instagram disables one method, others may still work. This is significantly more resilient than depending on a single GraphQL endpoint.

## Dependencies

| Package | Purpose |
|---|---|
| `next` | Framework |
| `react`, `react-dom` | UI |
| `typescript` | Type safety |
| `cheerio` | HTML parsing for embedded JSON extraction |
| `archiver` | Streaming ZIP generation |
| `tailwindcss` | Styling |

## Acceptance Criteria

- [ ] Paste a public Instagram post URL (`/p/`, `/reel/`, or `/tv/`), click Fetch, see media previews with thumbnails
- [ ] Download individual photos at highest available resolution
- [ ] Download individual videos at highest available quality
- [ ] Download carousel posts as a ZIP archive
- [ ] No authentication, tokens, or API keys required
- [ ] All error states show clear, actionable messages
- [ ] App runs locally on `localhost:3000` with `npm run dev`

## References & Research

- Brainstorm: `docs/brainstorms/2026-02-19-ig-downloader-brainstorm.md`
- Reference implementation: [`caofontaine/ig-downloader`](https://github.com/caofontaine/ig-downloader) — proven multi-fallback scraping approach
  - Key file: `apps/api/src/instagram.ts` — scraping logic, URL normalization, media extraction
  - Key file: `apps/api/src/app.ts` — API routes, proxy, download/ZIP endpoints
  - Key file: `apps/api/src/zip.ts` — streaming ZIP with `archiver`
  - Key file: `packages/shared/src/index.ts` — shared TypeScript types
- Next.js Route Handlers: [official docs](https://nextjs.org/docs/app/getting-started/route-handlers)
- cheerio: [documentation](https://cheerio.js.org/)
- archiver: [documentation](https://www.archiverjs.com/)
