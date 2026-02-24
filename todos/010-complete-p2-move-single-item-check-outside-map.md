---
status: complete
priority: p2
issue_id: "010"
tags: [code-review, quality, readability]
dependencies: []
---

# Move `items.length === 1` check outside `.map()` in `buildFilenames`

## Problem Statement

The `items.length === 1` check runs inside the `.map()` callback on every iteration, but the array length never changes during iteration. The previous code handled this as an early return before the loop, which was clearer. The current version buries branching logic inside the map callback.

## Findings

- **TypeScript Reviewer**: Flagged as moderate issue. Previous code was cleaner with the single-item case handled before the loop.
- **Simplicity Reviewer**: Confirmed the redundancy. Suggested either moving the check outside or always appending the index.
- **Location**: `app/api/download/route.ts:129-135`

## Proposed Solutions

### Option A: Early return for single item (Recommended)

```typescript
function buildFilenames(items: MediaItem[], meta?: ApiResponse["meta"]): string[] {
  const username = safeSegment(meta?.username ?? "instagram");
  const dateOrCode = meta?.postTimestamp
    ? formatTimestampForFilename(meta.postTimestamp)
    : safeSegment(meta?.shortcode ?? "post");

  if (items.length === 1) {
    const ext = getExtension(items[0].url, items[0].type);
    return [`${username}_${dateOrCode}.${ext}`];
  }

  return items.map((item, index) => {
    const ext = getExtension(item.url, item.type);
    return `${username}_${dateOrCode}_${index + 1}.${ext}`;
  });
}
```

- **Pros**: Clear separation of concerns, single-item case handled up front, map callback has single responsibility
- **Cons**: None
- **Effort**: Small
- **Risk**: None

### Option B: Conditional suffix in single expression

```typescript
const suffix = items.length > 1 ? `_${index + 1}` : "";
return `${username}_${dateOrCode}${suffix}.${ext}`;
```

- **Pros**: Single return path, compact
- **Cons**: Slightly less readable
- **Effort**: Small
- **Risk**: None

## Recommended Action

Use Option A: early return for the single-item case before the `.map()`. Keeps branching logic out of the iterator and makes intent clear at a glance.

## Technical Details

- **Affected files**: `app/api/download/route.ts`
- **Components**: `buildFilenames` function (lines 123-136)

## Acceptance Criteria

- [ ] `items.length` check is no longer inside the `.map()` callback
- [ ] Single-item and multi-item paths produce the same filenames as before

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-20 | Created from PR #2 code review | Prefer early returns over conditional branching inside iterators |
| 2026-02-24 | Approved during triage | Option A selected — early return before map; status changed from pending → ready |

## Resources

- PR: https://github.com/caofontaine/ig-downloader-compound/pull/2
