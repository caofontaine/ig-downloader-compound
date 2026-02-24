---
status: complete
priority: p1
issue_id: "014"
tags: [code-review, performance]
dependencies: []
---

# Post-redirect URLs not deduplicated in probe loop — duplicate probes after CDN 302

## Problem Statement

The `seen` Set in `tryUpgradeSize` tracks pre-redirect input URLs (the `probeUrl` strings built by `buildCandidateUrl`). But `probeImageUrl` returns `res.url` — the **final post-redirect URL** after the CDN's 302 chain. If two different candidate URLs redirect to the same final CDN URL, `seen` does not detect the duplicate and `probeImageDimensions` fires twice on the same resource.

Instagram CDN uses redirects extensively (e.g., tier candidates often redirect to the CDN's canonical form). This can cause 2x the expected probe count in practice.

## Findings

- **Performance Oracle**: P1. `seen` Set at `lib/media.ts:199` tracks pre-redirect strings only. A second `seenResults` Set tracking post-redirect `result` URLs would close the gap.
- **Location**: `lib/media.ts` lines 199–211 (probe loop in `tryUpgradeSize`)

## Proposed Solutions

### Option A: Add a second `seenResults` Set for post-redirect URLs

```typescript
const seen = new Set<string>();
const seenResults = new Set<string>();
for (const candidate of candidates) {
  const probeUrl = buildCandidateUrl(parsed, tokens, sizeIndex, candidate);
  if (seen.has(probeUrl)) continue;
  seen.add(probeUrl);
  const result = await probeImageUrl(probeUrl);
  if (!result) continue;
  if (seenResults.has(result)) continue;  // skip if redirect resolved to already-seen URL
  seenResults.add(result);
  const dims = await probeImageDimensions(result);
  ...
}
```

- **Pros**: Eliminates duplicate `probeImageDimensions` calls when CDN redirects different inputs to same URL.
- **Cons**: Slight added memory (negligible — small Set of strings).
- **Effort**: Small (4 lines)
- **Risk**: None

## Recommended Action

Use Option A: add `seenResults = new Set<string>()` tracking post-redirect result URLs in the probe loop. Skip candidates where `seenResults.has(result)` before calling `probeImageDimensions`.

## Technical Details

- **Affected files**: `lib/media.ts`
- **Affected function**: `tryUpgradeSize` probe loop

## Acceptance Criteria

- [ ] No URL is passed to `probeImageDimensions` more than once per `tryUpgradeSize` call, even when CDN redirects different candidates to the same final URL
- [ ] All unique post-redirect URLs are still tried

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-24 | Identified during code review | Flagged by performance-oracle |
| 2026-02-24 | Approved during triage | Status changed from pending → ready |

## Resources

- PR: https://github.com/caofontaine/ig-downloader-compound/pull/3
