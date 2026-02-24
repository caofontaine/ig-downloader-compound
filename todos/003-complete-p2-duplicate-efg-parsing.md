---
status: complete
priority: p2
issue_id: "003"
tags: [code-review, architecture]
dependencies: []
---

# Duplicate efg decoding logic between `media.ts` and `instagram.ts`

## Problem Statement

Two independent implementations decode the `efg` base64 URL parameter:

- `lib/media.ts:90-106` — `parseEfgDimensions()` for images, regex `/\.(\d{3,4})x(\d{3,4})\./`
- `lib/instagram.ts:465-486` — `inferVideoDimensionsFromUrl()` for videos, regex `/C\d\.(\d{3,4})\./`

Both share identical boilerplate: URL parsing, base64 decoding, JSON parsing, and `vencode_tag` extraction. They differ only in the regex applied to the tag string. If Instagram changes the `efg` encoding format, both must be updated in lockstep ("Shotgun Surgery" smell).

## Findings

- **TypeScript Reviewer**: Flagged as Medium. Recommended extracting shared `decodeEfgTag` helper.
- **Architecture Strategist**: Flagged as Medium. Identified as the most significant architectural concern in the PR.
- **Agent-Native Reviewer**: Also noted the duplication.

## Proposed Solutions

### Option A: Extract shared `decodeEfgTag(url)` helper

Create a helper that handles the common decode pipeline and returns just the `vencode_tag` string. Both callers apply their own regex.

```typescript
function decodeEfgTag(url: string): string | null {
  // shared: URL parse -> base64 decode -> JSON parse -> vencode_tag
}
```

- **Pros**: Eliminates duplicated decode logic. Single point of change if encoding changes.
- **Cons**: Creates a dependency from `instagram.ts` on a new helper (or requires moving to shared location).
- **Effort**: Small
- **Risk**: Low

### Option B: Leave as-is, document the duplication

Add comments in both locations cross-referencing each other.

- **Pros**: No code changes. The two patterns genuinely differ in what they extract.
- **Cons**: Duplication persists. Two files to update if encoding changes.
- **Effort**: Minimal
- **Risk**: Low (for a personal-use app with 2 call sites)

## Recommended Action

Use Option A: extract a shared `decodeEfgTag(url): string | null` helper into `lib/media.ts` (or a shared location). Both `parseEfgDimensions` and `inferVideoDimensionsFromUrl` call it and apply their own regex to the returned tag string.

## Technical Details

- **Affected files**: `lib/media.ts`, `lib/instagram.ts`

## Acceptance Criteria

- [ ] Shared decode logic is in a single function
- [ ] Both image and video efg parsing continue to work
- [ ] No regression in dimension extraction

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-19 | Identified during code review | Flagged by kieran-typescript-reviewer, architecture-strategist, agent-native-reviewer |
| 2026-02-24 | Approved during triage | Status changed from pending → ready |

## Resources

- PR: https://github.com/caofontaine/ig-downloader-compound/pull/1
- Known Pattern: [docs/solutions/logic-errors/image-resolution-capped-at-1080px-missing-efg-parameter.md](../docs/solutions/logic-errors/image-resolution-capped-at-1080px-missing-efg-parameter.md)
