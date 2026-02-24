---
status: complete
priority: p2
issue_id: "019"
tags: [code-review, performance, quality]
dependencies: []
---

# "Trust CDN" path skips dimension verification and causes double probe in `enrichMediaItems`

## Problem Statement

In `tryUpgradeSize`, when `probeImageDimensions` returns null for a successful candidate (network error, unsupported format), the code returns `{ url: result }` with no dims and trusts the CDN:

```typescript
if (!dims) return { url: result }; // can't verify, trust the CDN
```

This causes two problems:

1. **Verification skip**: The returned URL might not actually be higher resolution — the candidate could have 302'd to the original URL. We're accepting an unverified upgrade.

2. **Double probe**: Back in `enrichMediaItems`, since `promoted.dims` is `undefined`, it calls `probeImageDimensions` again on the same URL (line 30) — the exact probe that just failed inside `tryUpgradeSize`. This is a guaranteed wasted network request on the failure path.

## Findings

- **Code Simplicity Reviewer**: P2. Line 210 silent quality regression + double probe.
- **Performance Oracle**: P1/P2. The double probe is the opposite of the PR's optimization intent.
- **TypeScript Reviewer**: P1-B. Double probe not eliminated.
- **Location**: `lib/media.ts` lines 208–210 (`tryUpgradeSize`), lines 26–35 (`enrichMediaItems`)

## Proposed Solutions

### Option A: Require positive verification — don't trust CDN without dims

Change the guard to require dims for acceptance:

```typescript
const dims = await probeImageDimensions(result);
if (!dims || dims.width <= origW) continue;  // must verify improvement
return { url: result, dims };
```

- **Pros**: Eliminates the unverified-upgrade path. `dims` is always set on success. Removes double probe entirely. Simpler contract.
- **Cons**: May miss a valid upgrade on networks where probeImageDimensions intermittently fails. The old code was more permissive.
- **Effort**: Small (change 2 lines)
- **Risk**: Low — the "trust CDN" path was speculative anyway

### Option B: Remove `dims` from return type; always probe in `enrichMediaItems`

Remove the `dims?` field from `tryUpgradeSize`/`promoteImageUrl` return types entirely. `enrichMediaItems` always calls `probeImageDimensions` once after promotion. The internal `probeImageDimensions` call in `tryUpgradeSize` stays for verification only.

- **Pros**: Simpler types. Eliminates the threading complexity.
- **Cons**: One extra probe per successfully upgraded image (the original "double probe" problem that todo 001 was meant to fix).
- **Effort**: Small-Medium
- **Risk**: Low

## Recommended Action

Use Option A: require positive verification before accepting a candidate. Change `if (!dims) return { url: result }` to `if (!dims || dims.width <= origW) continue` so that the "trust CDN" path is eliminated and `dims` is always set on a successful return.

## Technical Details

- **Affected files**: `lib/media.ts`
- **Components**: `tryUpgradeSize` (line 208–210), `enrichMediaItems` (lines 26–35), `promoteImageUrl` return type

## Acceptance Criteria

- [ ] No URL is passed to `probeImageDimensions` twice in the same call chain for a single image
- [ ] Accepted upgraded URLs are verified to have larger dimensions OR the "trust CDN" path is explicitly documented as intentional

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-24 | Identified during code review | Flagged by code-simplicity-reviewer, performance-oracle, kieran-typescript-reviewer |
| 2026-02-24 | Approved during triage | Status changed from pending → ready |

## Resources

- PR: https://github.com/caofontaine/ig-downloader-compound/pull/3
