---
status: complete
priority: p2
issue_id: "005"
tags: [code-review, performance]
dependencies: []
---

# Duplicate candidate URLs not deduplicated before probing

## Problem Statement

When efg dimensions match API-reported `targetDimensions`, or when target dimensions happen to equal a tier value (e.g., 1200 or 1440), the same probe URL is constructed and tested multiple times. Each duplicate wastes 1-2 network requests.

## Findings

- **Performance Oracle**: Flagged as Priority 2. Recommended adding a `Set<string>` to skip already-probed URLs. One-line fix that avoids wasted requests when dimensions overlap.
- **Location**: `lib/media.ts` lines 186-198 (the `for` loop over candidates)

## Proposed Solutions

### Option A: Add URL deduplication Set

```typescript
const seen = new Set<string>();
for (const candidate of candidates) {
  const probeUrl = buildCandidateUrl(parsed, tokens, sizeIndex, candidate);
  if (seen.has(probeUrl)) continue;
  seen.add(probeUrl);
  // ...rest of probe logic
}
```

- **Pros**: Eliminates duplicate probes. Trivial implementation.
- **Cons**: None meaningful.
- **Effort**: Small (3 lines)
- **Risk**: None

## Recommended Action

Use Option A: add a `Set<string>` before the probe loop to skip duplicate URLs. Trivial fix with no downside.

## Technical Details

- **Affected files**: `lib/media.ts`
- **Affected function**: `tryUpgradeSize`

## Acceptance Criteria

- [ ] No URL is probed more than once in a single `tryUpgradeSize` call
- [ ] All unique candidates are still tried
- [ ] No regression in resolution quality

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-19 | Identified during code review | Flagged by performance-oracle |
| 2026-02-24 | Approved during triage | Status changed from pending → ready |

## Resources

- PR: https://github.com/caofontaine/ig-downloader-compound/pull/1
