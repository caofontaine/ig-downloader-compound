---
status: complete
priority: p2
issue_id: "001"
tags: [code-review, performance]
dependencies: []
---

# Redundant `probeImageDimensions` call wastes a network request per image

## Problem Statement

`tryUpgradeSize` calls `probeImageDimensions(result)` to verify the upgraded URL serves higher dimensions. Then `enrichMediaItems` immediately calls `probeImageDimensions(item.url)` on the same URL to populate `item.width`/`item.height`. Every successfully upgraded image has its dimensions probed twice -- each probe fetches 4KB via a Range request.

For a 10-image carousel, this wastes 10 unnecessary network round-trips.

## Findings

- **Performance Oracle**: Identified as Priority 1 optimization. Each probe is a real network request fetching 4KB of image data.
- **Simplicity Reviewer**: Flagged as duplicated work between `tryUpgradeSize` (line 193) and `enrichMediaItems` (line 25).
- **Location**: `lib/media.ts` lines 193-195 (inside waterfall) and lines 25-29 (in `enrichMediaItems`).

## Proposed Solutions

### Option A: Return verified dimensions from `tryUpgradeSize`

Change `tryUpgradeSize` return type to `{ url: string; dims?: { width: number; height: number } } | null`. Have `enrichMediaItems` reuse the already-probed dimensions.

- **Pros**: Eliminates redundant probe entirely. Clean data flow.
- **Cons**: Changes internal function signatures. Medium refactor.
- **Effort**: Small-Medium
- **Risk**: Low

### Option B: Remove verification from waterfall, verify once in `enrichMediaItems`

Remove `probeImageDimensions` from the waterfall loop. Let `enrichMediaItems` be the single place where dimensions are verified.

- **Pros**: Simpler waterfall. Fewer network requests in worst case.
- **Cons**: Loses the per-candidate dimension gate -- a candidate could be accepted without verification that it's actually higher resolution.
- **Effort**: Small
- **Risk**: Medium (could accept non-upgraded URLs)

## Recommended Action

Use Option A: change `tryUpgradeSize` return type to include optional dims, and have `enrichMediaItems` reuse them. This preserves the per-candidate dimension gate while eliminating the duplicate probe.

## Technical Details

- **Affected files**: `lib/media.ts`
- **Components**: `tryUpgradeSize`, `enrichMediaItems`, `promoteImageUrl`

## Acceptance Criteria

- [ ] `probeImageDimensions` is called at most once per image URL (not twice)
- [ ] Upgraded images still have correct `width`/`height` populated on `MediaItem`
- [ ] No regression in resolution quality
- [ ] `npm run build` and `npm run lint` pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-19 | Identified during code review | Flagged by performance-oracle and code-simplicity-reviewer |
| 2026-02-24 | Approved during triage | Status changed from pending → ready |

## Resources

- PR: https://github.com/caofontaine/ig-downloader-compound/pull/1
