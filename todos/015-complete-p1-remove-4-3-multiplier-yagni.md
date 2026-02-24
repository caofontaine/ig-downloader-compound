---
status: complete
priority: p1
issue_id: "015"
tags: [code-review, quality, simplicity]
dependencies: []
---

# Remove 4/3 multiplier candidate — YAGNI, superseded, always fires

## Problem Statement

`tryUpgradeSize` still appends a 4/3 multiplier candidate at position 5 (lines 193–196):

```typescript
const w43 = Math.round((origW * 4) / 3);
const h43 = Math.round((origH * 4) / 3);
if (w43 > origW) candidates.push({ w: w43, h: h43, prefix });
```

The `w43 > origW` guard is always true for any `origW >= 1`, so it always fires. There is no Instagram CDN tier based on a 4/3 multiplier — it produces URLs that either 404 or redirect to the same image. The efg-dimensions, target-dimensions, and known-tier (1440/1200) strategies already cover the full realistic Instagram size range. The 4/3 strategy was speculative and is now dead weight that generates wasted network probes.

## Findings

- **Code Simplicity Reviewer**: P1 (YAGNI). `lib/media.ts` lines 193–196. Always-true guard, no known Instagram CDN tier matches this formula, superseded by explicit strategies.
- **TypeScript Reviewer**: Also flagged `w43 > origW` as dead logic (always true).
- **Location**: `lib/media.ts` lines 193–196

## Proposed Solutions

### Option A: Delete lines 193–196

Simply remove the 4/3 multiplier candidate entirely.

- **Pros**: 4 fewer lines, 1–2 fewer network probes per image that exhausts the other candidates.
- **Cons**: Loses a speculative fallback that was never confirmed to work.
- **Effort**: Small (delete 4 lines)
- **Risk**: Low — the efg, target, and tier strategies are more accurate

## Recommended Action

Delete lines 193–196 in `lib/media.ts` entirely. The 4/3 multiplier has no valid Instagram CDN counterpart and the guard is always true.

## Technical Details

- **Affected files**: `lib/media.ts`
- **Affected function**: `tryUpgradeSize` candidate building

## Acceptance Criteria

- [ ] 4/3 multiplier removed from candidate list
- [ ] Waterfall still includes: efg dims, target dims, tiers (1440/1200), remove token
- [ ] No regression in resolution for common post types

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-24 | Identified during code review | Flagged by code-simplicity-reviewer and kieran-typescript-reviewer |
| 2026-02-24 | Approved during triage | Status changed from pending → ready |

## Resources

- PR: https://github.com/caofontaine/ig-downloader-compound/pull/3
