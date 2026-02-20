---
title: Image resolution capped at 1080px due to missing efg parameter parsing for images
date: 2026-02-19
category: logic-errors
tags:
  - instagram-scraping
  - image-resolution
  - cdn-optimization
  - efg-parameter-parsing
  - media-enrichment
severity: high
component: lib/media.ts
symptoms:
  - Downloaded images capped at 1080px maximum resolution
  - Higher resolution variants available on CDN not utilized
  - efg parameter dimensions only parsed for videos, not images
  - node.dimensions from API response not passed to upgrade function
resolution_time: moderate
---

# Image resolution capped at 1080px due to missing efg parameter parsing for images

## Problem

Instagram image downloads are capped at 1080px wide even when higher resolutions exist on the CDN. User-uploaded photos at 1200px, 1440px, or 1920px wide are downsampled to 1080px during download. The `display_resources` API field only provides candidates up to 1080px, and without additional resolution hints, the app cannot determine that the CDN stores the original at higher resolutions.

## Root Cause

The root cause chain involves three missed opportunities:

1. **API limitation**: Instagram's JSON response provides `display_resources` candidates only at 640px, 750px, and 1080px -- never higher. The app selects the largest (1080px).

2. **Unused dimension metadata**: The Instagram API response includes `node.dimensions` (the original upload dimensions), but this value was never passed forward to the URL upgrade logic. These dimensions would have guided the upgrade strategy.

3. **Unexploited `efg` parameter**: The CDN URL contains an `efg` query parameter with base64-encoded JSON holding a `vencode_tag` field (e.g., `xpids.1200x1600.sdr.C3`) that reveals actual CDN-available dimensions. This pattern was already parsed for videos in `lib/instagram.ts` (lines 465-486) but not leveraged for images.

Result: When the URL upgrade logic in `tryUpgradeSize` attempted its two strategies (remove size token, 4/3 multiplier), both failed, and the original 1080px URL was returned unchanged.

## Investigation Steps

1. Observed a CDN URL with `stp=dst-jpg_e35_s1080x1440` constraining the served image to 1080x1440 despite the original being 1200x1600.
2. Decoded the `efg` parameter and found base64 JSON: `{"vencode_tag":"xpids.1200x1600.sdr.C3"}`, confirming the CDN has 1200x1600 available.
3. Checked existing code and found `efg` parsing in `lib/instagram.ts` for videos (lines 465-486) but no equivalent for images in `lib/media.ts`.
4. Traced the data flow and confirmed that `node.dimensions` (from `extractFromMediaNode`) was stored in each `MediaItem` but never passed to the URL promotion function.
5. Identified where a multi-strategy waterfall with dimension inputs would fit in `tryUpgradeSize`.

## Solution

Rewrote `tryUpgradeSize` in `lib/media.ts` with a 5-strategy waterfall and two new helpers.

### parseEfgDimensions helper

Extract dimensions from the base64-encoded `efg` URL parameter:

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
    const match = /\.(\d{3,4})x(\d{3,4})\./.exec(tag);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
  } catch {
    return null;
  }
}
```

### Waterfall strategy in tryUpgradeSize

Accept optional target dimensions and build a candidate list in priority order:

1. **efg-derived dimensions** -- highest confidence, from CDN metadata
2. **API-reported target dimensions** -- from `node.dimensions`
3. **Remove size token entirely** -- existing strategy
4. **Known Instagram tiers** (1440, 1200) -- descending, with both `s` and `p` prefixes
5. **4/3 multiplier** -- existing fallback

Each successful probe is verified by checking actual served dimensions exceed the original:

```typescript
for (const candidate of candidates) {
  const probeUrl = buildCandidateUrl(parsed, tokens, sizeIndex, candidate);
  const result = await probeImageUrl(probeUrl);
  if (!result) continue;

  const dims = await probeImageDimensions(result);
  if (dims && dims.width > origW) return result;
  if (!dims) return result; // can't verify, trust the CDN
}
```

### Updated enrichMediaItems

Pass each item's stored dimensions (from `node.dimensions`) as the upgrade target:

```typescript
if (item.type === "image") {
  const target = item.width && item.height
    ? { width: item.width, height: item.height }
    : undefined;
  item.url = await promoteImageUrl(item.url, target);
}
```

### Changes summary

- `lib/media.ts`: 102 insertions, 27 deletions
- No changes to `lib/types.ts`, `lib/instagram.ts`, API routes, or UI components

## Verification

- Build passes (`npm run build`)
- Lint passes (`npm run lint`)
- No type changes needed -- `MediaItem` already has `width`/`height` fields
- Graceful degradation -- if all strategies fail, the original 1080px URL is returned

## Prevention Strategies

### Cross-media-type metadata propagation
When a feature (like efg parameter parsing) works for one media type (video), explicitly check if it should also apply to others (image). In this case, `inferVideoDimensionsFromUrl()` was only called for videos while images with the same CDN parameter were ignored.

### Multi-fallback source hierarchy
Document the source priority order for each metadata field. Before the fix, image dimensions only came from `display_resources` candidates. After the fix, they also flow from `node.dimensions` and `efg` parameters.

### Defensive dimension verification
Always verify dimensions are improvements, not regressions. The waterfall includes explicit checks (`dims.width > origW`) before accepting upgraded URLs, preventing acceptance of a "successful" CDN response that still has lower resolution.

### Graceful fallback chains
Each upgrade strategy is independent and tolerant of failure. If efg parsing fails, the next strategy executes without cascading errors. If all strategies fail, the original URL is returned.

## Known Limitations

- **CDN behavior opacity**: The `efg` parameter format is reverse-engineered. Instagram could change the encoding or JSON schema at any time. Parsing will silently fail and fall back to other strategies.
- **Missing efg parameter**: Not all images have an `efg` parameter. Older posts or fallback-sourced URLs may lack this metadata.
- **Probe latency**: The waterfall can trigger up to 4 HEAD requests per image in worst case (~100-500ms each). Mitigated by `Promise.all()` parallelism in `enrichMediaItems()` and short-circuiting on first success.
- **stp token mutation uncertainty**: Removing or modifying size tokens might affect other image transformations. Dimension verification post-probe catches unexpected mutations.

## Future Considerations

- **Monitor efg parsing failures**: If the efg parameter becomes unparseable across multiple posts, it signals Instagram changed the format.
- **Waterfall extension**: To add a new strategy, write a function returning `{ width, height } | null`, insert into the candidates array at appropriate priority -- no refactoring needed.
- **Cache probe outcomes**: For repeated downloads of the same post, cached dimension data could eliminate repeated HEAD requests.

## Related Documentation

- [docs/plans/2026-02-19-feat-higher-resolution-image-promotion-plan.md](../plans/2026-02-19-feat-higher-resolution-image-promotion-plan.md) -- Full feature plan with detailed analysis of stp/efg parameters
- [docs/research/2026-02-19-instagram-scraping-research.md](../research/2026-02-19-instagram-scraping-research.md) -- Instagram CDN URL structure and resolution tiers (Section 6)
- [docs/solutions/integration-issues/instagram-scraping-multi-fallback-architecture.md](integration-issues/instagram-scraping-multi-fallback-architecture.md) -- Related solution covering image URL promotion via CDN stp parameter
