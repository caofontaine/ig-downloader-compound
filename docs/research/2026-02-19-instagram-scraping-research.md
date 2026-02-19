# Instagram Scraping Research for Post Downloader

**Date:** 2026-02-19
**Status:** Complete
**Purpose:** Technical research for building a personal-use Instagram post downloader (Node.js/Next.js)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [How Instagram Embeds Data in Post Pages](#2-how-instagram-embeds-data-in-post-pages)
3. [The GraphQL API Approach (Recommended)](#3-the-graphql-api-approach-recommended)
4. [The Magic Parameters Approach (Requires Auth)](#4-the-magic-parameters-approach-requires-auth)
5. [Instagram's Anti-Scraping Measures](#5-instagrams-anti-scraping-measures)
6. [Getting Maximum Resolution Media](#6-getting-maximum-resolution-media)
7. [Carousel / Sidecar Post Handling](#7-carousel--sidecar-post-handling)
8. [Deprecated and Non-Working Approaches](#8-deprecated-and-non-working-approaches)
9. [Practical Implementation Strategy](#9-practical-implementation-strategy)
10. [Common Pitfalls and Breakage Patterns](#10-common-pitfalls-and-breakage-patterns)
11. [Response Data Structure Reference](#11-response-data-structure-reference)
12. [References](#12-references)

---

## 1. Executive Summary

There are two viable approaches for extracting media from public Instagram posts in 2025-2026:

| Approach | Auth Required | Reliability | Best For |
|---|---|---|---|
| **GraphQL API** (`/api/graphql`) | No (no cookies) | Medium -- doc_id changes every 2-4 weeks | This project (personal use, no auth) |
| **Magic Parameters** (`?__a=1&__d=dis`) | Yes (session cookie) | Higher when auth works | Scenarios where you can supply a session |

**The GraphQL approach is the recommended starting point** because it requires no authentication cookies. The main risk is that Instagram rotates the `doc_id` parameter every 2-4 weeks, requiring manual updates. For personal use with low request volumes, this is a manageable tradeoff.

The older methods -- `window._sharedData`, the `__a=1` endpoint without auth, and the unauthenticated oEmbed API -- are all dead as of 2024-2025.

---

## 2. How Instagram Embeds Data in Post Pages

### 2.1 window._sharedData (DEAD)

`window._sharedData` was historically the primary way Instagram embedded structured JSON in its HTML pages. Scrapers would fetch the HTML, regex out the JSON from a `<script>` tag, and parse it. **This no longer works.** Instagram removed this embedded data from public post pages. Fetching `https://www.instagram.com/p/SHORTCODE/` server-side now returns a login wall redirect or a minimal HTML shell that relies entirely on client-side JavaScript rendering.

### 2.2 window.__additionalDataLoaded (DEAD)

This was a secondary injection point that some scrapers used as a fallback. It is also no longer present in public page HTML.

### 2.3 JSON-LD / Schema.org (MINIMAL)

Instagram pages may contain basic `<script type="application/ld+json">` schema.org markup, but it does not include media URLs or the post data structure needed for downloading. It is not useful for this project.

### 2.4 Current Reality

Instagram's post pages are now fully client-side rendered React applications. The HTML returned by a server-side `fetch()` contains no useful post data. All meaningful data loading happens through XHR/fetch calls to Instagram's internal APIs after JavaScript execution. This means **you cannot simply fetch the HTML page and parse it** -- you must call Instagram's APIs directly.

---

## 3. The GraphQL API Approach (Recommended)

This is the approach used by the `instagram-media-scraper` project by Ahmed Rangel and confirmed working without authentication.

### 3.1 Endpoint

```
POST https://www.instagram.com/api/graphql
```

Note: Some sources reference `https://www.instagram.com/graphql/query` as an alternative endpoint. Both have been observed in use. The `/api/graphql` variant is what the working open-source scraper uses.

### 3.2 Request Format

The request is a POST with `application/x-www-form-urlencoded` content type. The parameters can be sent either as URL search params or form body. The working pattern sends them as URL search params on a POST:

```typescript
const graphqlUrl = new URL('https://www.instagram.com/api/graphql');
graphqlUrl.searchParams.set('variables', JSON.stringify({ shortcode: 'POST_SHORTCODE' }));
graphqlUrl.searchParams.set('doc_id', '10015901848480474');
graphqlUrl.searchParams.set('lsd', 'AVqbxe3J_YA');

const response = await fetch(graphqlUrl, {
  method: 'POST',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-IG-App-ID': '936619743392459',
    'X-FB-LSD': 'AVqbxe3J_YA',
    'X-ASBD-ID': '129477',
    'Sec-Fetch-Site': 'same-origin',
  },
});

const json = await response.json();
const postData = json?.data?.xdt_shortcode_media;
```

### 3.3 Key Parameters

| Parameter | Value | Notes |
|---|---|---|
| `doc_id` | `10015901848480474` | For single post queries. **Changes every 2-4 weeks.** |
| `variables` | `{"shortcode":"..."}` | URL-encoded JSON with the post's shortcode |
| `lsd` | `AVqbxe3J_YA` | A static-ish token. May need periodic updates. |

**Alternative doc_id values observed:**
- `8845758582119845` -- also reported for post queries (from ScrapFly, 2026)
- `9310670392322965` -- for profile posts
- `25981206651899035` -- for reels

The `fb_api_req_friendly_name` for post queries is `PolarisPostActionLoadPostQueryQuery`.

### 3.4 Required Headers

```typescript
const headers = {
  'User-Agent': '<realistic browser UA string>',
  'Content-Type': 'application/x-www-form-urlencoded',
  'X-IG-App-ID': '936619743392459',    // Instagram web app ID (stable)
  'X-FB-LSD': 'AVqbxe3J_YA',           // Anti-CSRF token (may change)
  'X-ASBD-ID': '129477',               // Unknown purpose, observed stable
  'Sec-Fetch-Site': 'same-origin',
};
```

**The `X-IG-App-ID` value `936619743392459`** is the desktop web Instagram app identifier. This value has been stable for years across multiple scraping projects.

### 3.5 How to Discover New doc_id Values When They Break

When the scraper stops working (returns errors or empty data), you need to find the current `doc_id`:

1. Open a browser, navigate to Instagram, and open DevTools (Network tab)
2. Filter network requests by "graphql"
3. Navigate to any Instagram post page
4. Look for POST requests to `/api/graphql` or `/graphql/query`
5. In the request payload, find the `doc_id` parameter value
6. Also note the `lsd` token value from the `X-FB-LSD` header or payload
7. Update your scraper with the new values

### 3.6 Response Structure

The response JSON has this shape:

```typescript
{
  data: {
    xdt_shortcode_media: {
      __typename: 'GraphImage' | 'GraphVideo' | 'GraphSidecar',
      shortcode: string,
      dimensions: { height: number, width: number },
      display_url: string,           // Full-resolution image URL
      display_resources: [           // Multiple resolution variants
        { src: string, config_width: number, config_height: number },
        // Typically includes 640, 750, and 1080 widths
      ],
      is_video: boolean,
      video_url?: string,            // For videos/reels
      video_view_count?: number,
      video_play_count?: number,
      video_duration?: number,
      has_audio?: boolean,
      thumbnail_src: string,
      owner: {
        username: string,
        full_name: string,
        profile_pic_url: string,
        is_verified: boolean,
      },
      edge_media_to_caption: {
        edges: [{ node: { text: string } }]
      },
      edge_media_preview_like: { count: number },
      edge_media_to_parent_comment: { count: number },
      product_type: string,          // 'feed', 'clips', 'carousel_container'
      is_paid_partnership: boolean,
      location?: { name: string },
      clips_music_attribution_info?: object,

      // CAROUSEL ONLY: present when __typename === 'GraphSidecar'
      edge_sidecar_to_children?: {
        edges: [{
          node: {
            __typename: 'GraphImage' | 'GraphVideo',
            shortcode: string,
            dimensions: { height: number, width: number },
            display_url: string,
            display_resources: [...],
            is_video: boolean,
            video_url?: string,
          }
        }]
      }
    }
  }
}
```

---

## 4. The Magic Parameters Approach (Requires Auth)

### 4.1 Endpoint

```
GET https://www.instagram.com/p/{SHORTCODE}?__a=1&__d=dis
```

### 4.2 Authentication Required

This endpoint **requires valid session cookies** (specifically `ds_user_id` and `sessionid`). Without them, it returns a login redirect or "page not available" error. The `__a=1` trick without authentication stopped working in 2023-2024.

### 4.3 Headers

```typescript
const headers = {
  'Cookie': `ds_user_id=${dsUserId}; sessionid=${sessionId}`,
  'User-Agent': '<realistic browser UA>',
  'X-IG-App-ID': '936619743392459',
  'Sec-Fetch-Site': 'same-origin',
};
```

### 4.4 Response Structure

The response uses a different structure from the GraphQL approach, organized under `items[0]`:

```typescript
{
  items: [{
    code: string,
    taken_at: number,           // Unix timestamp
    user: {
      username: string,
      full_name: string,
      profile_pic_url: string,
      is_verified: boolean,
    },
    is_paid_partnership: boolean,
    product_type: string,        // 'feed', 'clips', 'carousel_container'
    caption: { text: string },
    like_count: number,
    comment_count: number,
    view_count?: number,
    play_count?: number,
    video_duration?: number,
    location?: object,
    original_height: number,
    original_width: number,

    // Image versions - array sorted by quality (highest first)
    image_versions2: {
      candidates: [{
        url: string,
        width: number,
        height: number,
      }]
    },

    // Video versions - present for video posts
    video_versions?: [{
      url: string,
      width: number,
      height: number,
      type: number,
    }],

    // Carousel media - present when product_type === 'carousel_container'
    carousel_media?: [{
      image_versions2: { candidates: [...] },
      video_versions?: [...],
      original_width: number,
      original_height: number,
    }]
  }]
}
```

### 4.5 When to Use This Approach

- As a fallback if the GraphQL approach fails
- If you are comfortable providing your own Instagram session cookies
- If you need the `image_versions2.candidates` array (which provides multiple explicit resolution options sorted by size)

### 4.6 Risk

Using session cookies risks account suspension if Instagram detects automated access patterns. For personal use with low volume, the risk is minimal.

---

## 5. Instagram's Anti-Scraping Measures

### 5.1 Overview of Defense Layers

Instagram uses four main anti-scraping defense layers:

1. **Rate Limiting**: ~200 requests/hour per IP for unauthenticated requests. HTTP 429 "Too Many Requests" returned when exceeded. Repeated violations cause longer blocks and eventual permanent IP bans.

2. **IP Quality Detection**: Datacenter IP addresses are blocked almost instantly. Residential IPs are required for any meaningful volume. For personal use from a home IP, this is not a concern.

3. **TLS Fingerprinting**: Instagram fingerprints TLS handshakes. Python's `requests` library and Node.js `fetch()` have different TLS signatures than real browsers. At low volumes (personal use), this is rarely an issue. At scale, it triggers blocks.

4. **Behavioral Analysis**: Detects unnaturally consistent timing between requests (e.g., exact 3-second delays), missing or inconsistent headers, and session-level anomalies like changing User-Agent mid-session.

### 5.2 Login Wall Behavior

When Instagram detects server-side requests (non-browser), it often returns:
- A 302 redirect to the login page
- A minimal HTML page with no embedded data
- A JSON response with an error like "login_required"

This affects HTML page fetching but does **not** typically affect the GraphQL API endpoint when proper headers are sent.

### 5.3 Practical Mitigations for Personal Use

For a personal-use tool making ~1-10 requests per session:

1. **Use a realistic User-Agent string**: Match a current Chrome/Firefox browser.
2. **Send consistent headers**: Include `Accept-Language`, `Sec-Fetch-Site`, and the `X-IG-App-ID` header.
3. **Do not rotate User-Agent between requests**: Pick one and stick with it for the session.
4. **Add a small delay** (1-2 seconds) between requests if making multiple calls.
5. **Your home residential IP is fine**: No proxy rotation needed at this volume.

### 5.4 Required Headers Summary

```typescript
const REQUIRED_HEADERS = {
  // Mandatory
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'X-IG-App-ID': '936619743392459',

  // Strongly recommended
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',

  // GraphQL-specific
  'Content-Type': 'application/x-www-form-urlencoded',
  'X-FB-LSD': 'AVqbxe3J_YA',
  'X-ASBD-ID': '129477',
};
```

---

## 6. Getting Maximum Resolution Media

### 6.1 Photos

Instagram stores photos at a maximum width of **1080 pixels**. The actual resolution depends on the upload format:

| Format | Dimensions | Aspect Ratio |
|---|---|---|
| Square | 1080 x 1080 | 1:1 |
| Portrait | 1080 x 1350 | 4:5 |
| Landscape | 1080 x 566 | 16:9 |
| Tall Portrait (newer) | 1080 x 1440 | 3:4 |

**GraphQL response** (`display_resources` array):
The `display_resources` array contains multiple resolution variants, typically at widths of 640, 750, and 1080. The `display_url` field points to the highest-resolution version available.

```typescript
// To get the highest resolution image from GraphQL response:
const highestRes = postData.display_url;

// Or from display_resources, take the last (largest) entry:
const resources = postData.display_resources;
const largest = resources[resources.length - 1]; // { src, config_width, config_height }
```

**Magic Parameters response** (`image_versions2.candidates` array):
The `candidates` array is sorted by resolution (largest first). The first entry is the highest quality.

```typescript
// To get highest resolution from __a=1 response:
const highestRes = items.image_versions2.candidates[0].url;
```

### 6.2 Videos

Videos are available at various resolutions. The `video_url` field in the GraphQL response provides the video, but it may not always be the highest quality version.

In the `__a=1` response, `video_versions` is an array of objects, each with `url`, `width`, `height`, and `type`. The first entry is typically the highest quality.

```typescript
// GraphQL: video URL
const videoUrl = postData.video_url;

// __a=1: highest quality video (first candidate)
const videoUrl = items.video_versions[0].url;
```

**Instagram serves videos at up to 1080p.** The actual resolution depends on what was uploaded.

### 6.3 CDN URL Structure

Instagram media URLs are hosted on Facebook's CDN infrastructure:
- Image domain: `scontent-*.cdninstagram.com` or `*.fbcdn.net`
- Video domain: `*.cdninstagram.com` or `*.fbcdn.net`

URL paths may contain resolution parameters like `/s1080x1080/` or `/p1080x1080/`. Removing or modifying these segments does **not** reliably produce higher-resolution images -- Instagram is not an on-demand image processing CDN. Always use the URLs from the API response rather than trying to manipulate CDN URLs.

### 6.4 CDN URL Expiration

Instagram CDN URLs contain signed tokens and **expire after a period of time** (typically hours to days). Media URLs should be consumed promptly and not stored for later use. The download proxy should fetch media immediately when the user clicks download.

---

## 7. Carousel / Sidecar Post Handling

### 7.1 Detection

Carousel posts are identified by:
- **GraphQL**: `__typename === 'GraphSidecar'` or `product_type === 'carousel_container'`
- **Magic Parameters**: `product_type === 'carousel_container'`

### 7.2 GraphQL Carousel Structure

Carousel media items are nested under `edge_sidecar_to_children.edges`:

```typescript
const postData = json.data.xdt_shortcode_media;

if (postData.__typename === 'GraphSidecar') {
  const carouselItems = postData.edge_sidecar_to_children.edges.map(edge => ({
    type: edge.node.is_video ? 'video' : 'image',
    url: edge.node.is_video ? edge.node.video_url : edge.node.display_url,
    width: edge.node.dimensions.width,
    height: edge.node.dimensions.height,
    displayResources: edge.node.display_resources,
  }));
}
```

Each child node in `edge_sidecar_to_children.edges` has the same structure as a single post -- it includes `display_url`, `display_resources`, `is_video`, `video_url`, `dimensions`, etc.

### 7.3 Magic Parameters Carousel Structure

Carousel items are under `carousel_media`:

```typescript
const items = json.items[0];

if (items.product_type === 'carousel_container') {
  const carouselItems = items.carousel_media.map(media => ({
    type: media.video_versions ? 'video' : 'image',
    imageUrl: media.image_versions2.candidates[0].url,
    videoUrl: media.video_versions?.[0]?.url,
    width: media.original_width,
    height: media.original_height,
  }));
}
```

### 7.4 Carousel Limits

Instagram carousels can contain up to **20 slides** (increased from 10 in 2024). Each slide can be independently an image or video.

---

## 8. Deprecated and Non-Working Approaches

### 8.1 window._sharedData (Dead since ~2023)
Instagram no longer embeds post data in HTML `<script>` tags. Server-side HTML fetching returns no useful data.

### 8.2 window.__additionalDataLoaded (Dead)
Secondary injection point, also removed.

### 8.3 ?__a=1 Without Authentication (Dead since ~2023-2024)
The `https://www.instagram.com/p/SHORTCODE/?__a=1` endpoint now requires session cookies. Without them, it returns an error page.

### 8.4 Unauthenticated oEmbed API (Dead since April 2025)
Meta retired the old unauthenticated oEmbed endpoints in April 2025. The new Meta oEmbed Read API requires a registered Facebook app with an access token.

### 8.5 Old GraphQL query_hash Approach (Dead)
Instagram previously used `query_hash` parameters for GraphQL queries. These have been replaced by `doc_id` (persisted queries).

### 8.6 Instagram API v1 (Dead since March 2020)
The original public API at `https://api.instagram.com/v1/` was shut down in March 2020.

### 8.7 /p/SHORTCODE/embed/ Endpoint
The embed page endpoint exists but provides only limited embed HTML -- no structured media URLs suitable for downloading. The oEmbed API for programmatic access was deprecated in April 2025.

---

## 9. Practical Implementation Strategy

### 9.1 Recommended Architecture

```
[User pastes URL] -> [Next.js API Route] -> [Instagram GraphQL API] -> [Parse response] -> [Return media URLs to client]
                                                                                                |
[User clicks Download] -> [Next.js API Route] -> [Fetch from Instagram CDN] -> [Stream to user as download]
```

### 9.2 Step-by-Step Implementation

**Step 1: Extract shortcode from URL**

```typescript
function extractShortcode(url: string): string | null {
  const regex = /instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(p|reels|reel|stories)\/([A-Za-z0-9-_]+)/;
  const match = url.match(regex);
  return match?.[2] ?? null;
}
```

**Step 2: Fetch post data via GraphQL**

```typescript
async function fetchInstagramPost(shortcode: string) {
  const graphqlUrl = new URL('https://www.instagram.com/api/graphql');
  graphqlUrl.searchParams.set('variables', JSON.stringify({ shortcode }));
  graphqlUrl.searchParams.set('doc_id', '10015901848480474');
  graphqlUrl.searchParams.set('lsd', 'AVqbxe3J_YA');

  const response = await fetch(graphqlUrl, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-IG-App-ID': '936619743392459',
      'X-FB-LSD': 'AVqbxe3J_YA',
      'X-ASBD-ID': '129477',
      'Sec-Fetch-Site': 'same-origin',
    },
  });

  if (!response.ok) {
    throw new Error(`Instagram API returned ${response.status}`);
  }

  const json = await response.json();
  return json?.data?.xdt_shortcode_media;
}
```

**Step 3: Normalize the response into a consistent media structure**

```typescript
interface MediaItem {
  type: 'image' | 'video';
  url: string;           // Highest quality URL
  thumbnailUrl: string;  // For preview
  width: number;
  height: number;
}

interface PostData {
  shortcode: string;
  caption: string;
  ownerUsername: string;
  mediaItems: MediaItem[];
}

function normalizePostData(raw: any): PostData {
  const caption = raw.edge_media_to_caption?.edges?.[0]?.node?.text ?? '';
  const ownerUsername = raw.owner?.username ?? '';

  let mediaItems: MediaItem[];

  if (raw.__typename === 'GraphSidecar' && raw.edge_sidecar_to_children) {
    // Carousel post
    mediaItems = raw.edge_sidecar_to_children.edges.map((edge: any) => {
      const node = edge.node;
      return {
        type: node.is_video ? 'video' : 'image',
        url: node.is_video ? node.video_url : node.display_url,
        thumbnailUrl: node.display_resources?.[0]?.src ?? node.display_url,
        width: node.dimensions.width,
        height: node.dimensions.height,
      };
    });
  } else {
    // Single image or video
    mediaItems = [{
      type: raw.is_video ? 'video' : 'image',
      url: raw.is_video ? raw.video_url : raw.display_url,
      thumbnailUrl: raw.display_resources?.[0]?.src ?? raw.thumbnail_src,
      width: raw.dimensions.width,
      height: raw.dimensions.height,
    }];
  }

  return {
    shortcode: raw.shortcode,
    caption,
    ownerUsername,
    mediaItems,
  };
}
```

**Step 4: Proxy media downloads through the server**

This is needed because Instagram CDN URLs are cross-origin and have CORS restrictions. The proxy also sets `Content-Disposition` headers to trigger browser downloads.

```typescript
// In the Next.js route handler for /api/download
async function proxyDownload(mediaUrl: string, filename: string) {
  const response = await fetch(mediaUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...',
    },
  });

  if (!response.ok || !response.body) {
    throw new Error('Failed to fetch media from Instagram CDN');
  }

  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';

  return new Response(response.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': response.headers.get('content-length') ?? '',
    },
  });
}
```

### 9.3 Fallback Strategy

Build the implementation with a clean separation between the fetching logic and the normalization logic. This way, when Instagram changes `doc_id` values or the GraphQL structure, only the fetching layer needs updates:

```
lib/
  instagram/
    fetcher.ts        <- GraphQL API calls (changes when Instagram breaks things)
    normalizer.ts     <- Transform raw response to PostData (changes less often)
    types.ts          <- TypeScript interfaces (stable)
```

If the GraphQL approach stops working entirely, the `__a=1&__d=dis` approach with session cookies can be added as a fallback in `fetcher.ts` without changing the rest of the application.

---

## 10. Common Pitfalls and Breakage Patterns

### 10.1 doc_id Rotation (Most Common Breakage)

**What happens:** Instagram rotates GraphQL `doc_id` values every 2-4 weeks. Your scraper will suddenly return empty results or errors.

**Fix:** Use browser DevTools to discover the new `doc_id` (see Section 3.5). Consider logging errors clearly so you know when this happens.

### 10.2 CDN URL Expiration

**What happens:** Media URLs fetched from the API expire after a period (hours to days). If your app caches post data and a user tries to download later, the CDN URL may return a 403.

**Fix:** Always re-fetch the post data before downloading, or download immediately after fetching. Do not persist CDN URLs for later use.

### 10.3 Login Wall on HTML Pages

**What happens:** Fetching `https://www.instagram.com/p/SHORTCODE/` server-side returns a redirect to the login page instead of post HTML.

**Fix:** Do not rely on HTML page fetching. Use the GraphQL API directly.

### 10.4 Rate Limiting

**What happens:** Making too many requests (>200/hour per IP) triggers HTTP 429 responses. Continued violations escalate to temporary or permanent IP blocks.

**Fix:** For personal use, this is unlikely to be an issue. If you do hit it, add delays between requests and reduce batch sizes.

### 10.5 Inconsistent Response Shapes

**What happens:** Instagram may return slightly different response structures depending on the post type (image, video, reel, carousel, IGTV legacy). Fields that exist for one type may be null or missing for another.

**Fix:** Always use optional chaining (`?.`) and null coalescing (`??`) when accessing response fields. Test with all post types.

### 10.6 Private / Restricted Posts

**What happens:** If a post is from a private account or is age-restricted, the GraphQL API returns null or an error instead of post data.

**Fix:** Check for null `xdt_shortcode_media` and show a clear error: "This post is private or unavailable."

### 10.7 User-Agent Mismatch

**What happens:** Sending a stale or obviously bot-like User-Agent string causes Instagram to return errors or redirects.

**Fix:** Use a current, realistic browser User-Agent string. Update it every few months to match current browser versions.

### 10.8 Reel-Specific Behavior

**What happens:** Reels (short videos) may use a different `doc_id` or return data in a slightly different structure than regular posts.

**Fix:** Test with reel URLs specifically. The shortcode extraction regex already handles `/reel/` and `/reels/` URL patterns.

### 10.9 LSD Token Expiration

**What happens:** The `lsd` (LSD) token used in the X-FB-LSD header may change over time, causing authentication failures.

**Fix:** When the scraper breaks but the `doc_id` appears correct, check if the LSD token needs updating. You can find the current value in browser DevTools alongside the `doc_id`.

---

## 11. Response Data Structure Reference

### 11.1 GraphQL Post Types

| `__typename` | `product_type` | Description |
|---|---|---|
| `GraphImage` | `feed` | Single photo post |
| `GraphVideo` | `feed` or `clips` | Single video post or reel |
| `GraphSidecar` | `carousel_container` | Carousel with multiple images/videos |

### 11.2 Key Fields Quick Reference

```
xdt_shortcode_media
  .__typename              -> 'GraphImage' | 'GraphVideo' | 'GraphSidecar'
  .shortcode               -> string (the post ID from the URL)
  .display_url             -> string (highest res image URL for single posts)
  .display_resources[]     -> array of { src, config_width, config_height }
  .is_video                -> boolean
  .video_url               -> string (video download URL, if is_video)
  .dimensions              -> { width, height }
  .thumbnail_src           -> string (thumbnail URL)
  .owner.username          -> string
  .product_type            -> 'feed' | 'clips' | 'carousel_container'
  .edge_media_to_caption.edges[0].node.text  -> string (caption)
  .edge_sidecar_to_children.edges[].node     -> (same structure as single post)
```

### 11.3 display_resources Resolution Tiers

The `display_resources` array typically contains three entries:

| Index | config_width | Typical Use |
|---|---|---|
| 0 | 640 | Mobile / thumbnail |
| 1 | 750 | Medium screens |
| 2 | 1080 | Full resolution |

---

## 12. References

### Working Open-Source Scrapers
- [instagram-media-scraper by Ahmed Rangel](https://github.com/ahmedrangel/instagram-media-scraper) -- Node.js, GraphQL approach, confirmed working 2025
- [gallery-dl Instagram extractor](https://github.com/mikf/gallery-dl/blob/master/gallery_dl/extractor/instagram.py) -- Python, comprehensive, requires cookies
- [Instaloader](https://instaloader.github.io/) -- Python, well-maintained, public profiles without login at low volume
- [granary Instagram module](https://github.com/snarfed/granary/blob/main/granary/instagram.py) -- Python, uses both window._sharedData (legacy) and GraphQL

### Scraping Guides
- [How to Scrape Instagram in 2026 -- ScrapFly](https://scrapfly.io/blog/posts/how-to-scrape-instagram) -- Comprehensive guide with doc_id values and anti-scraping details
- [How to Scrape Instagram in 2025 -- Live Proxies](https://liveproxies.io/blog/instagram-scraping) -- GraphQL query structure and headers
- [Instagram Scraping in 2025: Workarounds That Still Work -- ScrapeCreators](https://scrapecreators.com/blog/instagram-scraping-in-2025-the-workarounds-that-still-work) -- Practical workarounds
- [Instagram Scraping Teardown -- ScrapeOps](https://scrapeops.io/websites/instagram/) -- Anti-scraping mechanism analysis

### Official Instagram Documentation
- [Image Resolution of Photos You Share on Instagram](https://help.instagram.com/1631821640426723/) -- Official resolution limits
- [Instagram API Deprecated Alternatives 2026 -- SociaVault](https://sociavault.com/blog/instagram-api-deprecated-alternative-2026)

### Technical References
- [Instagram GraphQL API Gist](https://gist.github.com/nownabe/202854eefce253d8eda0c4f79f1a645f) -- Endpoint documentation
- [instagram-php-scraper Endpoints](https://github.com/postaddictme/instagram-php-scraper/blob/master/src/InstagramScraper/Endpoints.php) -- Historical endpoint reference
