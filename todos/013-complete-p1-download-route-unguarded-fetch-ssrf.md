---
status: complete
priority: p1
issue_id: "013"
tags: [code-review, security]
dependencies: []
---

# `download/route.ts` streams `item.url` to client without CDN allowlist check (SSRF)

## Problem Statement

The download route calls `fetch(item.url)` directly for both single-item (line 48) and multi-item ZIP (line 89) downloads with no `isAllowedProxyUrl` check. This is the highest-impact SSRF vector in the codebase because it **streams the full response body** back to the client.

The proxy route has `isAllowedProxyUrl`. `probeImageUrl` now has `isAllowedProxyUrl`. The download route — which does the most with the URL — has nothing.

## Findings

- **Security Sentinel**: P1. `app/api/download/route.ts` lines 48 and 89 call `fetch(item.url)` without validation.
- **Location**: `app/api/download/route.ts:48` (single item) and `app/api/download/route.ts:89` (ZIP loop)

## Proposed Solutions

### Option A: Add allowlist check before each fetch

Import `isAllowedProxyUrl` from `@/lib/media` and guard both fetch calls:

```typescript
// Single item (line 47):
if (!isAllowedProxyUrl(item.url)) {
  return NextResponse.json<ApiResponse>(
    { status: "error", items: [], error: "Invalid media URL." },
    { status: 400 },
  );
}
const upstream = await fetch(item.url);

// ZIP loop (line 89):
if (!isAllowedProxyUrl(item.url)) { archive.abort(); return; }
const response = await fetch(item.url);
```

- **Pros**: Closes the highest-severity SSRF vector. Consistent with proxy route.
- **Cons**: None.
- **Effort**: Small (5 lines)
- **Risk**: None for valid Instagram URLs

## Recommended Action

Use Option A: import `isAllowedProxyUrl` from `@/lib/media` and gate both `fetch(item.url)` calls — return 400 for single item, abort archive for ZIP.

## Technical Details

- **Affected files**: `app/api/download/route.ts`
- **Components**: POST handler, single-item download (line 48), ZIP streaming loop (line 89)

## Acceptance Criteria

- [ ] Both `fetch(item.url)` calls in the download route are gated by `isAllowedProxyUrl`
- [ ] Non-CDN URLs return a 400 error instead of being fetched
- [ ] Normal Instagram downloads still work

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-24 | Identified during code review | Flagged by security-sentinel |
| 2026-02-24 | Approved during triage | Status changed from pending → ready |

## Resources

- PR: https://github.com/caofontaine/ig-downloader-compound/pull/3
