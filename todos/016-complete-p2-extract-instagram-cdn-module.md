---
status: complete
priority: p2
issue_id: "016"
tags: [code-review, architecture]
dependencies: []
---

# Extract `lib/instagram-cdn.ts` — `isAllowedProxyUrl` and `decodeEfgTag` in wrong module

## Problem Statement

Two functions live in `lib/media.ts` that don't belong there:

1. **`isAllowedProxyUrl`** — a security/routing concern (CDN allowlist for SSRF defense). `lib/media.ts` is an image enrichment module. Exporting a security validator from there makes it hard to discover during security audits and violates Single Responsibility.

2. **`decodeEfgTag`** — decodes Instagram's proprietary `efg` base64 URL parameter. This is Instagram-specific URL intelligence, not generic media processing. Currently `lib/instagram.ts` imports it from `lib/media.ts`, creating an inverted dependency: the higher-level Instagram scraping module depends on the lower-level enrichment module for a platform-specific utility.

## Findings

- **Architecture Strategist**: P2. Module boundary violation. `lib/media.ts` now owns image processing AND CDN access policy. `isAllowedProxyUrl` should be in `lib/instagram-cdn.ts`.
- **TypeScript Reviewer**: P2. `decodeEfgTag` exported from wrong module — reversed dependency with `instagram.ts`.
- **Location**: `lib/media.ts` lines 97–109 (`decodeEfgTag`), lines 216–229 (`isAllowedProxyUrl`)

## Proposed Solutions

### Option A: Create `lib/instagram-cdn.ts` with both functions

```typescript
// lib/instagram-cdn.ts
export function isAllowedProxyUrl(value: string): boolean {
  // ... exact same logic as now
}

export function decodeEfgTag(url: string): string | null {
  // ... exact same logic as now
}
```

Then:
- `lib/media.ts`: import both from `./instagram-cdn` (not re-exported)
- `app/api/proxy/route.ts`: import `isAllowedProxyUrl` from `@/lib/instagram-cdn`
- `lib/instagram.ts`: import `decodeEfgTag` from `./instagram-cdn` (peer import, not reversed)

- **Pros**: Single home for all Instagram CDN URL knowledge. Correct import direction. Security function discoverable in dedicated module.
- **Cons**: New file. Import paths change in 3 files.
- **Effort**: Small-Medium
- **Risk**: Low (pure refactor, same logic)

### Option B: Keep in `lib/media.ts` but add JSDoc explaining the security boundary

- **Pros**: No file changes beyond comments.
- **Cons**: Module boundary violation persists.
- **Effort**: Minimal
- **Risk**: None

## Recommended Action

Use Option A: create `lib/instagram-cdn.ts` with both `isAllowedProxyUrl` and `decodeEfgTag`. Update import paths in `lib/media.ts`, `lib/instagram.ts`, and `app/api/proxy/route.ts`. No logic changes — pure move.

## Technical Details

- **Affected files**: `lib/media.ts`, `lib/instagram.ts`, `app/api/proxy/route.ts` (new file: `lib/instagram-cdn.ts`)

## Acceptance Criteria

- [ ] `isAllowedProxyUrl` lives in a dedicated module, not `lib/media.ts`
- [ ] `decodeEfgTag` imported from the same dedicated module in both call sites
- [ ] Import direction: `media.ts` → `instagram-cdn.ts` ← `instagram.ts` (no reversed dependency)
- [ ] `npm run build` and `npm run lint` pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-24 | Identified during code review | Flagged by architecture-strategist and kieran-typescript-reviewer |
| 2026-02-24 | Approved during triage | Status changed from pending → ready |

## Resources

- PR: https://github.com/caofontaine/ig-downloader-compound/pull/3
