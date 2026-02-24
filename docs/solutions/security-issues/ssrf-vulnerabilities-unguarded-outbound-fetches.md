---
issue_id: ig-downloader-ssrf-unguarded-outbound-fetches
title: SSRF vulnerabilities from unguarded outbound fetches and redirect bypass in media pipeline
date: 2026-02-24
status: complete
priority: p1
tags:
  - security
  - ssrf
  - url-validation
  - module-architecture
  - performance
  - probe-dedup
symptoms:
  - probeImageDimensions issues GET requests with Range header to any URL it receives, including injected non-CDN URLs
  - fetchFileSize issues HEAD requests to arbitrary URLs without allowlist validation
  - download route streams full response body from unvalidated item.url (single item and ZIP)
  - probeImageUrl validates input URL but trusts res.url (post-redirect) without re-validation
  - resolveLegacyImageUrl returns res.url after a redirect without checking the destination is still on the CDN
  - isAllowedProxyUrl and decodeEfgTag buried in lib/media.ts (image enrichment module), not discoverable during security audits
  - Different candidates that 302 to the same final CDN URL cause probeImageDimensions to fire twice
  - 4/3 multiplier candidate always fires (always-true guard), generates wasted probes
  - tryUpgradeSize "trust CDN" fallback returns unverified URL, causing double probeImageDimensions call in enrichMediaItems
root_cause: >
  Multiple outbound fetch functions (probeImageDimensions, fetchFileSize, download route) lacked isAllowedProxyUrl
  guards; Node.js fetch follows HTTP 302 redirects automatically, so validating the input URL is insufficient —
  the post-redirect res.url must also be re-validated. Security logic was scattered across business-logic modules
  rather than centralised, making the gaps hard to discover during review.
solution_summary: >
  Centralised all CDN URL logic in a new lib/instagram-cdn.ts module; applied isAllowedProxyUrl guard at the entry
  point of every outbound fetch function; added post-redirect re-validation of res.url in probeImageUrl and
  resolveLegacyImageUrl; added seenResults dedup Set to prevent duplicate dimension probes; removed the dead 4/3
  multiplier candidate; tightened tryUpgradeSize to require verified dimension improvement before returning success.
affected_files:
  - lib/instagram-cdn.ts (new)
  - lib/media.ts
  - lib/instagram.ts
  - app/api/proxy/route.ts
  - app/api/download/route.ts
related_todos:
  - "012"
  - "013"
  - "014"
  - "015"
  - "016"
  - "017"
  - "018"
  - "019"
related_docs:
  - docs/solutions/integration-issues/instagram-scraping-multi-fallback-architecture.md
  - docs/solutions/logic-errors/image-resolution-capped-at-1080px-missing-efg-parameter.md
---

# SSRF vulnerabilities: unguarded outbound fetches and CDN redirect bypass

## Problem

When the PR that introduced image resolution promotion (`lib/media.ts`) added `isAllowedProxyUrl` to the proxy route and to `probeImageUrl`, it missed applying the same guard to three other outbound fetch sites. It also validated the *input* URL before fetching but did not re-validate the *output* URL (`res.url`) after a CDN redirect. Because Node.js `fetch` follows HTTP 302 chains automatically, a single unvalidated redirect is enough to reach an internal address.

### Attack vector

Instagram scrape responses are parsed from JSON/HTML returned by Instagram's servers. If an attacker influences that response (e.g. via a MITM, a compromised CDN response, or a crafted Instagram post whose JSON embeds a non-CDN URL), the injected URL flows into the media pipeline and gets fetched by the server. The most severe path streams the full response body back to the client via the download route.

### Probe loop correctness issues (co-located)

The same PR's probe loop in `tryUpgradeSize` had three correctness problems discovered during review:

- **Post-redirect dedup gap**: `seen` only tracked pre-redirect candidate URLs. Different candidates that 302 to the same CDN URL would both pass the dedup check and both trigger `probeImageDimensions`.
- **Dead 4/3 multiplier**: The always-true guard `if (w43 > origW)` (true for any `origW >= 1`) added an extra candidate matching no known Instagram CDN tier, generating wasted probes.
- **"Trust CDN" double probe**: `if (!dims) return { url: result }` returned an unverified upgrade. Back in `enrichMediaItems`, `promoted.dims` would be undefined, triggering another `probeImageDimensions` call on the same URL — the exact call that just failed inside `tryUpgradeSize`.

---

## Root cause

1. **Inconsistent guard application** — `isAllowedProxyUrl` was added to `probeImageUrl` (line 232) but not propagated to `probeImageDimensions`, `fetchFileSize`, or the download route.
2. **Redirect trust** — All `res.url` returns were used without re-validating the redirect destination. An allowed CDN host can serve a `Location` header pointing anywhere.
3. **Security logic in the wrong module** — `isAllowedProxyUrl` lived in `lib/media.ts` (image enrichment), making it invisible to security audits and creating an inverted import dependency (`lib/instagram.ts` importing from `lib/media.ts`).
4. **Pre-redirect-only dedup** — The `seen` Set in `tryUpgradeSize` operated on pre-redirect strings; duplicate post-redirect results were invisible to it.
5. **Unverified upgrade path** — The "trust CDN" fallback bypassed the guarantee that the returned URL actually had larger dimensions.

---

## Solution

### 1. Extract `lib/instagram-cdn.ts` (todo 016)

Created a dedicated module for all Instagram CDN URL knowledge. This makes the security boundary discoverable and corrects the import direction.

**`lib/instagram-cdn.ts` (new file):**

```typescript
export function isAllowedProxyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      host === "instagram.com" ||
      host.endsWith(".instagram.com") ||
      host.endsWith(".cdninstagram.com") ||
      host.endsWith(".fbcdn.net")
    );
  } catch {
    return false;
  }
}

export function decodeEfgTag(url: string): string | null {
  try {
    const parsed = new URL(url);
    const efg = parsed.searchParams.get("efg");
    if (!efg) return null;
    const decoded = Buffer.from(decodeURIComponent(efg), "base64").toString("utf8");
    const payload = JSON.parse(decoded);
    const tag = payload?.vencode_tag;
    return typeof tag === "string" ? tag : null;
  } catch {
    return null;
  }
}
```

**Import direction after extraction:**

```
lib/media.ts ──→ lib/instagram-cdn.ts ←── lib/instagram.ts
                        ↑
             app/api/proxy/route.ts
             app/api/download/route.ts
```

Before the fix, `lib/instagram.ts` imported `decodeEfgTag` from `lib/media.ts` — a high-level scraping module depending on a lower-level enrichment module for a platform-specific utility.

---

### 2. Guard `fetchFileSize` (todo 017)

```typescript
// Before
async function fetchFileSize(url: string): Promise<number> {
  try {
    const res = await fetchWithTimeout(url, { method: "HEAD" });

// After
async function fetchFileSize(url: string): Promise<number> {
  if (!isAllowedProxyUrl(url)) return 0;
  try {
    const res = await fetchWithTimeout(url, { method: "HEAD" });
```

HEAD requests expose whether an internal address is live and can leak `Content-Length` from internal services.

---

### 3. Guard `probeImageDimensions` (todo 012)

```typescript
// Before
export async function probeImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0", Range: "bytes=0-4095" } });

// After
export async function probeImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  if (!isAllowedProxyUrl(url)) return null;
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0", Range: "bytes=0-4095" } });
```

This function fetches up to 4 KB of image data. Called via `enrichMediaItems` directly with `item.url` from scraped JSON.

---

### 4. Re-validate post-redirect URLs (todo 018)

**`probeImageUrl` — both HEAD and GET fallback paths:**

```typescript
// Before
if (res.ok && contentType.startsWith("image/")) return res.url || url;

// After
const finalUrl = res.url || url;
if (res.ok && contentType.startsWith("image/") && isAllowedProxyUrl(finalUrl)) return finalUrl;
```

**`resolveLegacyImageUrl` in `lib/media.ts`:**

```typescript
// Before
if (!res.ok || !contentType.startsWith("image/")) return null;
if (res.body) { try { await res.body.cancel(); } catch { /* ignore */ } }
return res.url || url;

// After
if (!res.ok || !contentType.startsWith("image/")) return null;
const finalUrl = res.url || url;
if (!isAllowedProxyUrl(finalUrl)) return null;
if (res.body) { try { await res.body.cancel(); } catch { /* ignore */ } }
return finalUrl;
```

---

### 5. Guard both `fetch(item.url)` calls in download route (todo 013)

This is the highest-impact SSRF vector: it streams the full response body back to the client.

**Single-item path:**

```typescript
// Before
const item = result.items[0];
const upstream = await fetch(item.url);

// After
const item = result.items[0];
if (!isAllowedProxyUrl(item.url)) {
  return NextResponse.json<ApiResponse>(
    { status: "error", items: [], error: "Invalid media URL." },
    { status: 400 },
  );
}
const upstream = await fetch(item.url);
```

**ZIP loop:**

```typescript
// Before
const response = await fetch(item.url);

// After
if (!isAllowedProxyUrl(item.url)) { archive.abort(); return; }
const response = await fetch(item.url);
```

---

### 6. Add post-redirect dedup in probe loop (todo 014)

```typescript
// Before
const seen = new Set<string>();
for (const candidate of candidates) {
  const probeUrl = buildCandidateUrl(parsed, tokens, sizeIndex, candidate);
  if (seen.has(probeUrl)) continue;
  seen.add(probeUrl);
  const result = await probeImageUrl(probeUrl);
  if (!result) continue;
  const dims = await probeImageDimensions(result);

// After
const seen = new Set<string>();
const seenResults = new Set<string>();
for (const candidate of candidates) {
  const probeUrl = buildCandidateUrl(parsed, tokens, sizeIndex, candidate);
  if (seen.has(probeUrl)) continue;
  seen.add(probeUrl);
  const result = await probeImageUrl(probeUrl);
  if (!result) continue;
  if (seenResults.has(result)) continue;
  seenResults.add(result);
  const dims = await probeImageDimensions(result);
```

Two different candidate URLs that 302 to the same CDN URL would both pass the `seen` check (different input strings) but the same `result` — now caught by `seenResults`.

---

### 7. Remove 4/3 multiplier candidate (todo 015)

```typescript
// Removed entirely:
// 5. 4/3 multiplier
const w43 = Math.round((origW * 4) / 3);
const h43 = Math.round((origH * 4) / 3);
if (w43 > origW) candidates.push({ w: w43, h: h43, prefix });
```

The guard `w43 > origW` is always true for any `origW >= 1`. No known Instagram CDN tier uses a 4/3 multiplier. The efg, target, and tier (1440/1200) strategies cover the full realistic range.

---

### 8. Require verified improvement; eliminate "trust CDN" path (todo 019)

```typescript
// Before — return type has dims as optional; unverified fallback exists
): Promise<{ url: string; dims?: { width: number; height: number } } | null> {
  ...
  const dims = await probeImageDimensions(result);
  if (dims && dims.width > origW) return { url: result, dims };
  if (!dims) return { url: result }; // can't verify, trust the CDN

// After — dims required on success; single verification gate
): Promise<{ url: string; dims: { width: number; height: number } } | null> {
  ...
  const dims = await probeImageDimensions(result);
  if (!dims || dims.width <= origW) continue; // must verify improvement
  return { url: result, dims };
```

The old fallback caused a double probe: `tryUpgradeSize` returned `{ url: result }` with no dims → `enrichMediaItems` saw `promoted.dims === undefined` → called `probeImageDimensions` again on the same URL that just failed. Now `tryUpgradeSize` either returns verified dims or `null`.

---

## Prevention

### Rule: Guard every outbound fetch at the function boundary

Don't rely on callers having validated the URL. Every function that issues a network request to an external URL must validate at entry:

```typescript
// Pattern for probe/enrichment functions
if (!isAllowedProxyUrl(url)) return null; // or 0, or safe default

// Pattern for API routes returning data to clients
if (!isAllowedProxyUrl(item.url)) {
  return NextResponse.json({ status: "error", error: "Invalid media URL." }, { status: 400 });
}
```

### Rule: Re-validate `res.url` after any fetch that follows redirects

Node.js `fetch` follows redirects by default. The input URL being allowed is not sufficient — always re-validate the post-redirect destination:

```typescript
const finalUrl = res.url || url;
if (!isAllowedProxyUrl(finalUrl)) return null;
// use finalUrl, not res.url || url inline
```

### Rule: Security validators belong in a dedicated module

`isAllowedProxyUrl` lives in `lib/instagram-cdn.ts`. Import it from there — not from business logic modules. This ensures it's findable during security audits and that the import direction is correct.

### Rule: Dedup both pre- and post-transform state in loops

When a loop transforms data (URL → redirected URL), maintain two Sets:

- `seen` — input strings (prevents duplicate candidate probes)
- `seenResults` — output strings (prevents duplicate work when different inputs produce the same output)

### Rule: Require proof before returning success from verification-dependent paths

If a function's contract is "return a better URL with verified dimensions", it must not return without both. Return `null` on verification failure and let callers decide the fallback, rather than returning unverified results that cause downstream re-work.

### Code review checklist for this codebase

- [ ] Every new `fetch()` / `fetchWithTimeout()` call — is it guarded by `isAllowedProxyUrl`?
- [ ] Every use of `res.url` — is it re-validated before being stored or returned?
- [ ] Any new utility function exported from `lib/media.ts` — does it belong in `lib/instagram-cdn.ts` instead?
- [ ] Any new probe loop — does it track both pre- and post-redirect dedup?
- [ ] Any conditional with an always-true guard — is the code actually needed?

---

## Test cases

```
// SSRF guard
probeImageDimensions("http://169.254.169.254/metadata") → null, fetch never called
fetchFileSize("http://internal.net/secret") → 0, fetch never called
POST /api/download with item.url = "http://localhost:8888/" → 400

// Redirect bypass
probeImageUrl that 302s to "http://attacker.com/" → null (post-redirect rejected)
resolveLegacyImageUrl that 302s to non-CDN → null

// Dedup
Two candidates both 302 to same CDN URL → probeImageDimensions called once, not twice

// Verified upgrade
tryUpgradeSize where probe returns same-size dims → null (not accepted as upgrade)
tryUpgradeSize where probe fails → null (no "trust CDN" path)
```

---

## References

- PR #3: https://github.com/caofontaine/ig-downloader-compound/pull/3
- Commit `78d57e9`: `fix(security): resolve 8 code-review todos — SSRF guards, probe dedup, YAGNI cleanup`
- Related: [Instagram scraping multi-fallback architecture](../integration-issues/instagram-scraping-multi-fallback-architecture.md)
- Related: [Image resolution capped at 1080px](../logic-errors/image-resolution-capped-at-1080px-missing-efg-parameter.md)
