---
title: "feat: Improve image resolution promotion beyond 1080px"
type: feat
status: completed
date: 2026-02-19
---

# feat: Improve image resolution promotion beyond 1080px

## Overview

The app currently caps image resolution at 1080px wide because Instagram's API only provides `display_resources` candidates up to 1080px. However, the CDN often stores the original upload at higher resolutions (1200px, 1440px). The `stp=` parameter in CDN URLs controls server-side resizing, and the `efg` parameter encodes the actual available dimensions — but the app only leverages these partially today.

## Problem Statement

**Observed:** User fetches a photo whose CDN URL with `stp=dst-jpg_e35_tt6` serves at 1200x1600. The app returns 1080x1440.

**Root cause chain:**

1. Instagram's `?__a=1&__d=dis` JSON response provides `display_resources` with candidates at 640px, 750px, and 1080px wide — never higher (`lib/instagram.ts:162-165`).
2. `extractFromMediaNode` picks the 1080px candidate via `pickLargest` (`lib/instagram.ts:165`).
3. The CDN URL for the 1080px candidate has `stp=dst-jpg_e35_s1080x1440` — the `s1080x1440` token instructs the CDN to downscale.
4. `tryUpgradeSize` (`lib/media.ts:83-124`) attempts two strategies:
   - **Remove size token** → probe URL with `stp=dst-jpg_e35` → may fail or redirect back to constrained URL
   - **4/3 multiplier** → try `s1440x1920` → fails if the original is only 1200x1600
5. Both strategies fail, and the original 1080px URL is returned unchanged.

**Missed opportunity:** The `efg` parameter in the same URL contains base64-encoded JSON: `{"vencode_tag":"xpids.1200x1600.sdr.C3"}`, revealing the actual CDN-available dimensions (1200x1600). The code already parses this format for videos (`lib/instagram.ts:465-486`) but not for images.

## Proposed Solution

Enhance `tryUpgradeSize` in `lib/media.ts` with a multi-strategy waterfall that leverages all available dimension signals.

### Strategy Waterfall (highest priority first)

1. **Parse `efg` dimensions from URL** — Extract actual CDN-available dimensions from the `efg` base64 parameter. Use these as the target `stp=` size.
2. **Use API-reported `node.dimensions`** — The Instagram JSON response includes `dimensions: { width, height }` representing the original upload. Pass these through to `tryUpgradeSize` as a target.
3. **Remove size token entirely** — Existing strategy, kept as-is.
4. **Try descending resolution tiers** — For each tier (1440, 1200), compute proportional height from the original aspect ratio and probe. Try both `p` (fit-within) and `s` (exact-scale) prefixes.
5. **4/3 multiplier** — Existing fallback, kept as last resort.

After each successful probe, **verify the actual served resolution** by probing image header dimensions. If the CDN silently redirected to a lower resolution, continue to the next strategy.

### Changes by File

#### `lib/media.ts`

- **`tryUpgradeSize(url, targetDimensions?)`** — Accept optional target dimensions. Add `efg` parsing. Implement multi-tier waterfall. After a probe succeeds, verify actual served dimensions exceed the original.
- **`parseEfgDimensions(url)`** — New helper. Decode the `efg` base64 parameter, extract dimensions from `vencode_tag` patterns like `xpids.WIDTHxHEIGHT.sdr.*` or `C\d.WIDTH.` (extend the existing video pattern).
- **`promoteImageUrl(url, targetDimensions?)`** — Pass through target dimensions to `tryUpgradeSize`.
- **`enrichMediaItems(items)`** — Pass each item's `width`/`height` (which come from `node.dimensions` via `extractFromMediaNode`) as `targetDimensions` to `promoteImageUrl`.

#### `lib/instagram.ts`

- **`extractFromMediaNode`** — Ensure `node.dimensions` values are preserved on the `MediaItem` before `enrichMediaItems` runs (already done at lines 200-201, no change needed).

### No Changes Needed

- `lib/types.ts` — `MediaItem` already has `width`/`height` fields.
- `app/api/` routes — No changes; they call `enrichMediaItems` which handles everything.
- UI components — No changes; they display whatever resolution is returned.

## Technical Considerations

- **CDN behavior is opaque**: Instagram's CDN may return different results depending on geographic region, caching state, or request headers. All probing must be done defensively with fallbacks.
- **Performance**: Each additional probe is a HEAD request (~50-100ms). The waterfall adds at most 3-4 extra probes per image in the worst case. Since these run in parallel across carousel items, the overall impact is minimal.
- **`efg` parameter may not always be present**: Not all CDN URLs include `efg`. The code must handle its absence gracefully.
- **Redirect detection**: `probeImageUrl` returns `res.url` after redirects. If the CDN redirects a modified URL back to the 1080px version, we need to detect this by either checking the returned URL's `stp=` parameter or probing the actual dimensions of the response.

## Acceptance Criteria

- [x] For the specific test URL, the app returns 1200x1600 instead of 1080x1440
- [x] For photos originally uploaded at 1440x1920, the app returns 1440x1920 (when CDN serves it)
- [x] For photos natively 1080px wide, behavior is unchanged (no regression)
- [x] The waterfall falls through gracefully — if all upgrades fail, the original 1080px URL is returned
- [x] No additional user-visible latency for the common case (1080px photos)
- [x] `efg` parsing works for image URLs (extending existing video-only logic)

## MVP

### `lib/media.ts` — Updated `tryUpgradeSize`

```typescript
async function tryUpgradeSize(
  url: string,
  targetDimensions?: { width: number; height: number },
): Promise<string | null> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }

  const stp = parsed.searchParams.get("stp");
  if (!stp) return null;

  const tokens = stp.split("_");
  const sizeIndex = tokens.findIndex((t) => /^(p|s)\d+x\d+$/.test(t));
  if (sizeIndex === -1) return null;

  const match = /^(p|s)(\d+)x(\d+)$/.exec(tokens[sizeIndex]);
  if (!match) return null;
  const [, prefix, wRaw, hRaw] = match;
  const origW = Number(wRaw);
  const origH = Number(hRaw);
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
```

### `lib/media.ts` — New `parseEfgDimensions`

```typescript
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
```

### `lib/media.ts` — New `buildCandidateUrl`

```typescript
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
```

### `lib/media.ts` — Updated `promoteImageUrl` and `enrichMediaItems`

```typescript
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
      // ... rest unchanged
    }),
  );
}
```

## Dependencies & Risks

- **Instagram CDN changes**: The `efg` parameter format or `stp=` token behavior could change at any time. All parsing is best-effort with graceful fallbacks.
- **Probe latency**: Worst case adds ~4 sequential HEAD requests per image if all early strategies fail. Acceptable for personal use.
- **False positives**: CDN could accept a modified URL but serve a blank/error image with a valid content-type. The dimension verification step mitigates this.

## References & Research

- `lib/media.ts:83-124` — Current `tryUpgradeSize` implementation
- `lib/media.ts:126-143` — `probeImageUrl` validation
- `lib/media.ts:157-166` — `probeImageDimensions` header parsing
- `lib/instagram.ts:148-204` — `extractFromMediaNode` with `node.dimensions` access
- `lib/instagram.ts:465-486` — Existing `efg` parsing for videos (pattern to extend for images)
- `docs/research/2026-02-19-instagram-scraping-research.md:348-379` — Instagram resolution tiers documentation
