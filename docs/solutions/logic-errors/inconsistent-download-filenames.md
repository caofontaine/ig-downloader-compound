---
title: inconsistent-download-filenames
category: logic-errors
severity: medium
tags:
  - file-naming
  - instagram-metadata
  - timestamp-formatting
  - carousel-handling
  - filename-consistency
  - content-disposition
components:
  - app/api/download/route.ts
  - lib/types.ts
date_resolved: "2026-02-20"
symptoms:
  - Single files named with download timestamp (Date.now()) instead of post date
  - Carousel files used shortcode with no date information
  - Inconsistent naming convention across single vs carousel downloads
  - Single files hardcoded extension (jpg/mp4) while carousel items used URL detection
---

# Inconsistent Download Filenames: Wrong Timestamp Source and Divergent Code Paths

## Problem

Downloaded Instagram files had inconsistent and uninformative naming. Two separate code paths in `buildFilenames()` used completely different logic:

| Item type | Old format | Issue |
|-----------|-----------|-------|
| Single file | `username_20260220_143052.jpg` | Used `Date.now()` (download time, not post date); hardcoded extension |
| Carousel in ZIP | `username_post_CxAbCdEfG_1.jpg` | Used shortcode, no date at all; used `getExtension()` |

Users couldn't identify when content was originally posted, and identical posts downloaded at different times received different filenames.

## Root Cause

The `buildFilenames()` function in `app/api/download/route.ts` had two fundamental issues:

1. **Wrong timestamp source.** Single files used `Date.now()` (the download time) instead of `meta.postTimestamp` (the actual post creation date from Instagram metadata). The post timestamp was already available in the `meta` object but was never used.

2. **Divergent code paths.** The single-item branch (`items.length === 1`) was an early return with completely separate logic from the carousel branch. This led to: different timestamp strategies, different extension detection methods, and different filename formats.

## Solution

**File modified:** `app/api/download/route.ts`

### 1. Renamed and rewrote `formatDateTimeStamp()` to `formatIsoTimestamp()`

```typescript
// BEFORE: compact format with download timestamp
function formatDateTimeStamp(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

// AFTER: ISO-8601-style with colons removed for filesystem safety
function formatIsoTimestamp(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `${date}T${time}.000Z`;
}
```

### 2. Unified `buildFilenames()` for all item types

```typescript
// BEFORE: two divergent code paths
function buildFilenames(items: MediaItem[], meta?: ApiResponse["meta"]): string[] {
  const username = safeSegment(meta?.username ?? "instagram");
  if (items.length === 1) {
    const ext = items[0].type === "video" ? "mp4" : "jpg";
    const dateStamp = formatDateTimeStamp(Date.now());
    return [`${username}_${dateStamp}.${ext}`];
  }
  const shortcode = safeSegment(meta?.shortcode ?? "post");
  return items.map((item, index) => {
    const ext = getExtension(item.url, item.type);
    return `${username}_post_${shortcode}_${index + 1}.${ext}`;
  });
}

// AFTER: single unified path
function buildFilenames(items: MediaItem[], meta?: ApiResponse["meta"]): string[] {
  const username = safeSegment(meta?.username ?? "instagram");
  const dateOrCode = meta?.postTimestamp
    ? formatIsoTimestamp(meta.postTimestamp)
    : safeSegment(meta?.shortcode ?? "post");

  return items.map((item, index) => {
    const ext = getExtension(item.url, item.type);
    if (items.length === 1) {
      return `${username}_${dateOrCode}.${ext}`;
    }
    return `${username}_${dateOrCode}_${index + 1}.${ext}`;
  });
}
```

### Result

| Scenario | New filename | Example |
|----------|-------------|---------|
| Single image | `{username}_{isoDate}.{ext}` | `johndoe_2026-02-15T080000.000Z.jpg` |
| Carousel item | `{username}_{isoDate}_{index}.{ext}` | `johndoe_2026-02-15T080000.000Z_1.jpg` |
| No timestamp | `{username}_{shortcode}.{ext}` | `johndoe_CxAbCdEfG.jpg` |
| ZIP archive | `{username}_post_{shortcode}.zip` | `johndoe_post_CxAbCdEfG.zip` (unchanged) |

## Key Design Decisions

1. **Post date over download date.** `meta.postTimestamp` from Instagram scraping gives semantic meaning — identical posts always get the same filename regardless of when downloaded.

2. **ISO-8601-style format (`YYYY-MM-DDTHHMMSS.000Z`).** Colons removed for filesystem safety (invalid on Windows). Hyphens, `T`, and `Z` retained for readability. `.000Z` retained per user preference (milliseconds are always zero since Instagram uses second precision).

3. **Shortcode fallback.** When `meta.postTimestamp` is undefined (some scraping strategies fail to extract a date), falls back to the Instagram shortcode which is always available from the URL.

4. **Timestamp NOT passed through `safeSegment()`.** The ISO format is deterministic — it only produces digits, hyphens, `T`, `.`, and `Z`, all of which are filesystem-safe. Running it through `safeSegment()` would mangle the format (dots become underscores).

5. **Unified `getExtension()`.** Both single and carousel items now use URL-based extension detection instead of hardcoding `jpg`/`mp4`.

6. **ZIP name unchanged.** The ZIP archive name stays as `{username}_post_{shortcode}.zip` — no need to change it since the shortcode uniquely identifies the post.

## Data Flow

```
Instagram page → lib/instagram.ts::findPostTimestamp()
    ↓
meta.postTimestamp (Unix ms, may be undefined)
    ↓
app/api/download/route.ts::buildFilenames()
    ↓
formatIsoTimestamp() or shortcode fallback
    ↓
Content-Disposition header: attachment; filename="username_2026-02-15T080000.000Z.jpg"
```

**Timestamp precision varies by scraping strategy:**
- Strategy 1 (JSON API): Full second precision via `taken_at_timestamp`
- Strategies 2-4 (HTML/embed/OG fallbacks): Date-only precision (time shows as `T000000.000Z`)

## Prevention Strategies

1. **Unify code paths for the same operation.** When single-item and multi-item branches need different behavior, extract the shared logic and branch only on the minimal difference (presence/absence of an index suffix). Avoid completely separate code paths that drift apart.

2. **Prefer source metadata over runtime values.** Never use `Date.now()` or other runtime state for user-facing identifiers. Use the source data (`postTimestamp`, `shortcode`, `username`) so filenames are stable and meaningful.

3. **Use helper functions uniformly.** If `getExtension()` exists for URL-based extension detection, use it everywhere — don't hardcode `jpg`/`mp4` in one branch and use the helper in another.

4. **Document the fallback chain.** The fallback hierarchy (`postTimestamp` → `shortcode` → `"post"`) should be explicit and documented, so future changes don't accidentally break it.

5. **Distinguish deterministic from untrusted values.** `safeSegment()` is for external/untrusted input (usernames, shortcodes). Deterministic format outputs (ISO timestamps) don't need sanitization and would be mangled by it.

## Related Documentation

- [Instagram Scraping Multi-Fallback Architecture](../integration-issues/instagram-scraping-multi-fallback-architecture.md) — How `postTimestamp` is extracted across four scraping strategies
- [Image Resolution Capped at 1080px](./image-resolution-capped-at-1080px-missing-efg-parameter.md) — Related URL parsing patterns in `getExtension()`
- [Descriptive Download Filenames Plan](../../plans/2026-02-20-feat-descriptive-download-filenames-plan.md) — Full design specification for this change
- PR: https://github.com/caofontaine/ig-downloader-compound/pull/2
