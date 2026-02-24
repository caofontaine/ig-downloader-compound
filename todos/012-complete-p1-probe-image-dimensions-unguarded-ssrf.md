---
status: complete
priority: p1
issue_id: "012"
tags: [code-review, security]
dependencies: []
---

# `probeImageDimensions` makes unguarded outbound fetches (SSRF)

## Problem Statement

`probeImageDimensions` issues a real HTTP GET request (`Range: bytes=0-4095`) to any URL it receives with no call to `isAllowedProxyUrl` before fetching. This PR added `isAllowedProxyUrl` guard to `probeImageUrl`, but forgot to apply the same guard to `probeImageDimensions`.

Called in two paths:
1. `enrichMediaItems` line 30 — directly with `item.url` from Instagram JSON/HTML (unvalidated)
2. `tryUpgradeSize` line 208 — with `result` from `probeImageUrl` (safer, but still unguarded at the function level)

Path (1) is exploitable: if an attacker influences the Instagram scrape response to inject a URL like `http://169.254.169.254/latest/meta-data/`, the server will send a GET with a `Range` header to that internal address.

## Findings

- **Security Sentinel**: P1. `probeImageDimensions` at `lib/media.ts:263` has no `isAllowedProxyUrl` check. This PR added the guard to `probeImageUrl` (line 232) but not to `probeImageDimensions`.
- **Location**: `lib/media.ts` line 263 (`probeImageDimensions` function start)

## Proposed Solutions

### Option A: Add guard at top of `probeImageDimensions`

```typescript
export async function probeImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  if (!isAllowedProxyUrl(url)) return null;  // add this line
  try {
    const res = await fetchWithTimeout(url, { ... });
```

- **Pros**: Mirrors exactly what was done to `probeImageUrl`. One-line fix. Defense-in-depth.
- **Cons**: None.
- **Effort**: Small (1 line)
- **Risk**: None

## Recommended Action

Add `if (!isAllowedProxyUrl(url)) return null;` as the first line of `probeImageDimensions`, mirroring exactly what was done to `probeImageUrl` in this PR.

## Technical Details

- **Affected files**: `lib/media.ts`
- **Components**: `probeImageDimensions` (line 263)

## Acceptance Criteria

- [ ] `probeImageDimensions` returns `null` for non-CDN URLs without making a network request
- [ ] `npm run build` and `npm run lint` pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-24 | Identified during code review | Flagged by security-sentinel |
| 2026-02-24 | Approved during triage | Status changed from pending → ready |

## Resources

- PR: https://github.com/caofontaine/ig-downloader-compound/pull/3
