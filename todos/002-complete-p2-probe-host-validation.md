---
status: complete
priority: p2
issue_id: "002"
tags: [code-review, security]
dependencies: []
---

# No host validation on outbound probe requests (SSRF defense-in-depth)

## Problem Statement

`probeImageUrl` and `probeImageDimensions` make outbound HEAD/GET requests to URLs without validating that the hostname belongs to Instagram CDN domains. The proxy route (`app/api/proxy/route.ts`) already has an `isAllowedProxyUrl` allowlist checking for `*.instagram.com`, `*.cdninstagram.com`, and `*.fbcdn.net`. The probe functions lack this same check.

While `buildCandidateUrl` only modifies query parameters (not the host), the initial URL originates from Instagram's API response. If that response were compromised, the server would make requests to arbitrary hosts.

## Findings

- **Security Sentinel**: Flagged as Medium severity. Defense-in-depth concern -- not immediately exploitable but inconsistent with the proxy route's existing validation.
- **Location**: `lib/media.ts` lines 201-218 (`probeImageUrl`) and lines 232-241 (`probeImageDimensions`).
- **Contrast**: `app/api/proxy/route.ts` lines 3-16 has `isAllowedProxyUrl` with proper hostname allowlist.

## Proposed Solutions

### Option A: Add hostname allowlist to `probeImageUrl`

Add an `isAllowedCdnHost` check at the top of `probeImageUrl` that validates the hostname against `*.cdninstagram.com` and `*.fbcdn.net`.

- **Pros**: Consistent with proxy route. Minimal code change (~5 lines).
- **Cons**: Could break if Instagram introduces new CDN domains.
- **Effort**: Small
- **Risk**: Low

### Option B: Shared allowlist function in `lib/media.ts`

Extract the proxy route's `isAllowedProxyUrl` into a shared utility and use it in both places.

- **Pros**: Single source of truth for allowed domains.
- **Cons**: Slightly more refactoring.
- **Effort**: Small
- **Risk**: Low

## Recommended Action

Use Option B: extract `isAllowedProxyUrl` from `app/api/proxy/route.ts` into a shared utility (e.g., `lib/media.ts` or a new `lib/cdn.ts`) and use it in both the proxy route and the probe functions. Single source of truth for allowed CDN domains.

## Technical Details

- **Affected files**: `lib/media.ts`, optionally `app/api/proxy/route.ts`

## Acceptance Criteria

- [ ] `probeImageUrl` validates hostname before making requests
- [ ] Only Instagram CDN domains are probed
- [ ] Non-CDN URLs return null without making network requests
- [ ] Existing functionality unchanged for valid Instagram CDN URLs

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-19 | Identified during code review | Flagged by security-sentinel |
| 2026-02-24 | Approved during triage | Option B selected — shared utility; status changed from pending → ready |

## Resources

- PR: https://github.com/caofontaine/ig-downloader-compound/pull/1
