---
status: complete
priority: p2
issue_id: "004"
tags: [code-review, quality]
dependencies: []
---

# "Remove" candidate at position 3 may short-circuit better tier strategies

## Problem Statement

The waterfall in `tryUpgradeSize` places the "remove size token" strategy at position 3 (after efg and API dims, but before tier probing). If the efg probe fails at the HTTP level but "remove" succeeds and returns an intermediate resolution (e.g., 1200px when 1440px is available via tiers), the waterfall short-circuits and skips the tier-based candidates that might have found the higher resolution.

## Findings

- **TypeScript Reviewer**: Flagged as Critical concern (though not merge-blocking). Recommended reordering "remove" to after tier strategies since it is the least precise strategy -- essentially "let the CDN decide."
- **Location**: `lib/media.ts` line 169 (`candidates.push("remove")`)

## Proposed Solutions

### Option A: Move "remove" to position 5 (after tiers, before 4/3)

Reorder the candidates array so "remove" runs after the explicit tier probes.

- **Pros**: More precise strategies get priority. Less chance of accepting intermediate resolution.
- **Cons**: "Remove" was previously the first strategy in the old code and worked well as a general approach. Moving it down means 2-4 extra probes before trying it.
- **Effort**: Small (reorder ~2 lines)
- **Risk**: Low

### Option B: Keep current ordering but add deduplication

Keep "remove" at position 3 but add a `Set` to skip candidates producing URLs already probed.

- **Pros**: Doesn't change strategy ordering. Reduces wasted probes from duplicate URLs.
- **Cons**: Doesn't address the core issue of intermediate resolution acceptance.
- **Effort**: Small
- **Risk**: Low

## Recommended Action

Use Option A: move "remove" to after the tier-based candidates so explicit dimension strategies run first. "Remove" should be a last-resort fallback, not an early short-circuit.

## Technical Details

- **Affected files**: `lib/media.ts`
- **Affected function**: `tryUpgradeSize`

## Acceptance Criteria

- [ ] Tier-based strategies run before the "remove" fallback
- [ ] Higher resolution is returned when CDN supports it
- [ ] No regression for posts where "remove" was the only successful strategy

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-19 | Identified during code review | Flagged by kieran-typescript-reviewer |
| 2026-02-24 | Approved during triage | Status changed from pending → ready |

## Resources

- PR: https://github.com/caofontaine/ig-downloader-compound/pull/1
