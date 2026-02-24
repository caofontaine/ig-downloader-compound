---
status: complete
priority: p2
issue_id: "017"
tags: [code-review, security]
dependencies: []
---

# `fetchFileSize` issues HEAD requests without CDN allowlist guard

## Problem Statement

`fetchFileSize` makes a real HEAD request to any URL it receives without calling `isAllowedProxyUrl` first. It is called unconditionally for every media item in `enrichMediaItems` (line 44):

```typescript
item.filesize = await fetchFileSize(item.url);
```

This is a lower-severity SSRF vector than GET paths (HEAD requests return less data), but it still leaks whether an internal address is live and can expose `Content-Length` from internal services.

## Findings

- **Security Sentinel**: P2. `lib/media.ts` lines 44 and 49–57. `fetchFileSize` issues HEAD without allowlist guard.
- **Location**: `lib/media.ts` lines 49–58 (`fetchFileSize` function)

## Proposed Solutions

### Option A: Add guard at top of `fetchFileSize`

```typescript
async function fetchFileSize(url: string): Promise<number> {
  if (!isAllowedProxyUrl(url)) return 0;  // add this line
  try {
    const res = await fetchWithTimeout(url, { method: "HEAD" });
```

- **Pros**: One-line fix. Consistent with treatment of other outbound functions.
- **Cons**: None.
- **Effort**: Small (1 line)
- **Risk**: None for valid Instagram CDN URLs

## Recommended Action

Add `if (!isAllowedProxyUrl(url)) return 0;` as the first line of `fetchFileSize`, mirroring what was done to `probeImageUrl` and `probeImageDimensions`.

## Technical Details

- **Affected files**: `lib/media.ts`
- **Components**: `fetchFileSize` (line 49)

## Acceptance Criteria

- [ ] `fetchFileSize` returns `0` for non-CDN URLs without making a network request
- [ ] Valid Instagram CDN URLs still return correct file sizes

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-24 | Identified during code review | Flagged by security-sentinel |
| 2026-02-24 | Approved during triage | Status changed from pending → ready |

## Resources

- PR: https://github.com/caofontaine/ig-downloader-compound/pull/3
