---
title: "feat: Descriptive download filenames with username and post date"
type: feat
status: completed
date: 2026-02-20
---

# feat: Descriptive download filenames with username and post date

## Overview

Rename downloaded Instagram files to include the Instagram username and the date the content was posted, using an ISO-8601-style timestamp format. Carousel files bundled in a ZIP should follow the same naming convention with a 1-based index suffix.

## Problem Statement / Motivation

Currently, downloaded files have inconsistent naming:
- **Single files:** `{username}_{YYYYMMDD_HHmmss}.{ext}` using the download timestamp (not the post date)
- **Carousel files in ZIP:** `{username}_post_{shortcode}_{index}.{ext}` with no date at all

Users want filenames that reflect **when the content was posted**, making it easy to organize and identify downloaded media by date.

## Proposed Solution

### New Filename Formats

| Scenario | Format | Example |
|---|---|---|
| Single file (timestamp available) | `{username}_{isoDate}.{ext}` | `johndoe_2026-02-15T080000.000Z.jpg` |
| Single file (no timestamp) | `{username}_{shortcode}.{ext}` | `johndoe_CxAbCdEfG.jpg` |
| Carousel file in ZIP (timestamp available) | `{username}_{isoDate}_{index}.{ext}` | `johndoe_2026-02-15T080000.000Z_1.jpg` |
| Carousel file in ZIP (no timestamp) | `{username}_{shortcode}_{index}.{ext}` | `johndoe_CxAbCdEfG_1.jpg` |
| ZIP archive name | **No change** | `johndoe_post_CxAbCdEfG.zip` |

### ISO-8601 Timestamp Format

Format: `YYYY-MM-DDTHHMMSS.000Z` (colons removed for filesystem safety)

- Hyphens in date portion: **retained** (`2026-02-15`)
- `T` separator: **retained**
- Colons in time portion: **removed** (`080000` not `08:00:00`)
- Milliseconds: **retained** (`.000` — always zero since Instagram uses second precision)
- UTC indicator: **retained** (`Z`)

### Fallback Strategy

When `meta.postTimestamp` is undefined (all scraping strategies fail to find a date):
- Fall back to **shortcode** as the identifier: `{username}_{shortcode}.{ext}`
- The shortcode is always available since it is extracted from the URL before any scraping occurs

## Technical Considerations

### Files to Modify

Only one file requires changes:

**`app/api/download/route.ts`**

| Function | Current (line) | Change |
|---|---|---|
| `formatDateTimeStamp()` | Line 158 | Rename to `formatIsoTimestamp()`, output `YYYY-MM-DDTHHMMSS.000Z` format |
| `buildFilenames()` | Line 123 | Use `meta.postTimestamp` instead of `Date.now()`, add shortcode fallback, add index for carousel, unify extension detection |
| `buildZipName()` | Line 137 | **No change** — keep current format |
| `safeSegment()` | Line 153 | **No change** — only applied to username, NOT to the date string |
| `getExtension()` | Line 143 | **No change** — but now also used for single-item downloads |

### Implementation Details

#### 1. Rename and rewrite `formatDateTimeStamp()` → `formatIsoTimestamp()`

```typescript
// app/api/download/route.ts
function formatIsoTimestamp(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `${date}T${time}.000Z`;
}
```

#### 2. Rewrite `buildFilenames()`

```typescript
// app/api/download/route.ts
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

Key changes:
- Uses `meta.postTimestamp` (post date) instead of `Date.now()` (download time)
- Falls back to shortcode when timestamp is unavailable
- Uses `getExtension()` for all items (single + carousel) for consistency
- Carousel files get a 1-based `_{index}` suffix

#### 3. No changes to `buildZipName()`

ZIP archive names remain `{username}_post_{shortcode}.zip` per user preference.

### Edge Cases

| Edge Case | Handling |
|---|---|
| `postTimestamp` undefined | Fall back to shortcode: `{username}_{shortcode}.{ext}` |
| `username` undefined | Fall back to `"instagram"` (existing behavior via `safeSegment()`) |
| Date-only precision (fallback strategies) | Time shows as `T000000.000Z` — acceptable, no special handling |
| `safeSegment()` and date string | Date string is NOT passed through `safeSegment()` — its format is deterministic and already filesystem-safe |
| Long usernames (up to 30 chars) | Total filename stays well within OS limits (~60 chars max) |
| Extension detection for single items | Now uses `getExtension()` instead of hardcoded jpg/mp4 |

## Acceptance Criteria

- [x] Single-file downloads are named `{username}_{YYYY-MM-DDTHHMMSS.000Z}.{ext}` using the post date
- [x] Carousel files inside ZIP are named `{username}_{YYYY-MM-DDTHHMMSS.000Z}_{index}.{ext}` with 1-based index
- [x] When post date is unavailable, filenames fall back to `{username}_{shortcode}.{ext}`
- [x] ZIP archive names remain unchanged (`{username}_post_{shortcode}.zip`)
- [x] File extensions are detected from URL for both single and carousel items
- [x] `safeSegment()` is only applied to username, not to the date string
- [x] Timestamps use UTC (indicated by `Z` suffix)

## References & Research

### Internal References

- Download route with current naming: `app/api/download/route.ts:123-162`
- Type definitions with `postTimestamp`: `lib/types.ts` (`ApiResponse.meta`)
- Timestamp extraction: `lib/instagram.ts:395-429`
- Client-side filename parsing: `app/page.tsx:148` (`getFilenameFromHeader()`)
- Documented scraping architecture: `docs/solutions/integration-issues/instagram-scraping-multi-fallback-architecture.md`
