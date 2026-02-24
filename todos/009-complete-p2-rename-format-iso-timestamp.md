---
status: complete
priority: p2
issue_id: "009"
tags: [code-review, quality, naming]
dependencies: []
---

# Rename `formatIsoTimestamp` to a more accurate name

## Problem Statement

The function `formatIsoTimestamp` produces `2026-02-15T080000.000Z` which is not valid ISO-8601 (colons are removed from the time portion). The name implies ISO compliance it doesn't have. A developer reading the name will expect standard ISO output and be surprised by the modified format.

## Findings

- **TypeScript Reviewer**: Flagged as moderate issue. "Violates the 5-second rule -- a developer reading `formatIsoTimestamp` will expect standard ISO output."
- **Simplicity Reviewer**: Noted the format is a "strange hybrid" that is neither valid ISO-8601 nor a compact timestamp.
- **Location**: `app/api/download/route.ts:159`

## Proposed Solutions

### Option A: Rename to `formatTimestampForFilename`

Rename to clearly indicate the output is filesystem-safe, not standards-compliant.

- **Pros**: Accurate, self-documenting
- **Cons**: Slightly longer name
- **Effort**: Small (one rename)
- **Risk**: None

### Option B: Rename to `formatFilesafeTimestamp`

Shorter alternative that emphasizes filesystem safety.

- **Pros**: Concise, clear intent
- **Cons**: "Filesafe" is not a standard term
- **Effort**: Small
- **Risk**: None

## Recommended Action

Use Option A: rename `formatIsoTimestamp` to `formatTimestampForFilename`. Update all call sites in `app/api/download/route.ts`.

## Technical Details

- **Affected files**: `app/api/download/route.ts`
- **Components**: `formatIsoTimestamp` function (line 159)

## Acceptance Criteria

- [ ] Function name no longer implies ISO-8601 compliance
- [ ] All call sites updated

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from PR #2 code review | Function naming should match actual output format |
| 2026-02-24 | Approved during triage | Option A selected — rename to `formatTimestampForFilename`; status changed from pending → ready |

## Resources

- PR: https://github.com/caofontaine/ig-downloader-compound/pull/2
