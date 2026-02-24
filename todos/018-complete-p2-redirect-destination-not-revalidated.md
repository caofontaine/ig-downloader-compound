---
status: complete
priority: p2
issue_id: "018"
tags: [code-review, security]
dependencies: []
---

# Redirect destinations from CDN fetches not re-validated — redirect-based SSRF bypass

## Problem Statement

`isAllowedProxyUrl` is checked against the **input URL** before a fetch, but Node.js `fetch` follows HTTP 302 redirects automatically. If an allowed CDN hostname (e.g., `scontent.cdninstagram.com`) serves a `Location` header pointing to an internal IP or non-CDN host, `fetchWithTimeout` silently follows it.

The `res.url` returned afterward reflects the **redirect destination**, not the original URL. This post-redirect URL is used as:
- The promoted image URL stored in `item.url`
- The URL passed to `probeImageDimensions`

This means the allowlist is bypassed via an open redirect on the CDN side: the first hop is allowed, but the destination is not validated.

## Findings

- **Security Sentinel**: P2. Redirect-based SSRF. Affects `probeImageUrl` (line 204–209) and `resolveLegacyImageUrl` (lines 83–95).
- **Location**: `lib/media.ts` lines 204–244 (`probeImageUrl`, `probeImageDimensions`)

## Proposed Solutions

### Option A: Re-validate `res.url` against `isAllowedProxyUrl` after redirect

In `probeImageUrl`, after each fetch that follows redirects:

```typescript
const finalUrl = res.url || url;
if (!isAllowedProxyUrl(finalUrl)) return null;  // reject if redirect left allowed CDN
return finalUrl;
```

- **Pros**: Closes the redirect-based bypass. Minimal change.
- **Cons**: Could theoretically break legitimate Instagram CDN redirect chains if they cross subdomains not in the allowlist. Very unlikely but worth monitoring.
- **Effort**: Small (2–4 lines per fetch site)
- **Risk**: Low

### Option B: Use `redirect: "manual"` and handle 3xx explicitly

Pass `redirect: "manual"` in fetch options and validate `Location` header before following.

- **Pros**: Full control over redirect chain.
- **Cons**: More code, needs loop for multi-hop redirects.
- **Effort**: Medium
- **Risk**: Low

## Recommended Action

Use Option A: re-validate `res.url` against `isAllowedProxyUrl` after each fetch in `probeImageUrl` and `resolveLegacyImageUrl`. Return `null` if the redirect destination is not on the CDN allowlist.

## Technical Details

- **Affected files**: `lib/media.ts`
- **Components**: `probeImageUrl` (lines 231–249), `resolveLegacyImageUrl` (lines 77–88)

## Acceptance Criteria

- [ ] `res.url` (post-redirect) is validated against `isAllowedProxyUrl` before being used or returned
- [ ] Non-CDN redirect destinations are rejected

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-24 | Identified during code review | Flagged by security-sentinel |
| 2026-02-24 | Approved during triage | Status changed from pending → ready |

## Resources

- PR: https://github.com/caofontaine/ig-downloader-compound/pull/3
