# Instagram Post Downloader — Brainstorm

**Date:** 2026-02-19
**Status:** Draft

## What We're Building

A personal-use web app for downloading Instagram posts (photos, videos, carousels) from public profiles at the highest quality available.

**Input:** A single Instagram post URL (e.g., `https://instagram.com/p/abc123`)
**Output:** Preview of all media in the post, with individual and bulk download options at max resolution.

## Why This Approach

### Tech Stack: Next.js
- Single project handles both the UI (React) and backend (API routes)
- No need to manage separate frontend/backend services
- Good developer experience for a personal tool

### Scraping Strategy: Direct HTML/JSON parsing (server-side)
- Fetch the Instagram post page from a Next.js API route
- Parse embedded JSON data (e.g., `window._sharedData` or equivalent) to extract media URLs at full resolution
- Proxy downloads through the server to avoid CORS issues
- No external dependencies — self-contained
- Tradeoff: may break if Instagram changes page structure, but acceptable for personal use

### Scope: Individual posts only
- Paste a single post URL — no profile browsing or bulk profile scraping
- Keeps the app focused and simple
- Runs locally (localhost) — no deployment or hosting needed

### Stories: Deferred
- Instagram stories require authentication (session cookie) even for public profiles
- Out of scope for v1 — can be added later with cookie-based auth

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Audience | Personal use | No need for auth, rate limiting, or abuse prevention |
| Interface | Web UI (browser) | Paste URL, see previews, click download |
| Framework | Next.js (React) | Full-stack in one project |
| Fetching method | Direct scraping | No external dependencies, full control |
| Post types | All (photos, videos, carousels) | Comprehensive from day one |
| UX flow | Preview + bulk download | Show media previews, individual + "Download All" buttons |
| Scope | Individual post URLs only | No profile-level browsing |
| Stories | Deferred to v2 | Requires auth, separate concern |

## UX Flow

1. User opens the app in their browser
2. Pastes an Instagram post URL into an input field
3. App fetches the post metadata server-side (API route)
4. UI displays: post preview (thumbnails/video players) and media count
5. For single media: one download button
6. For carousels: individual download buttons per item + "Download All" button
7. Downloads are proxied through the server at highest available quality

## Open Questions

- **Instagram's anti-scraping measures:** How aggressively does Instagram block server-side requests? May need to rotate user-agent headers or add request delays.
- **Video quality:** Does Instagram's embedded JSON include the highest quality video URL, or is additional work needed to get max resolution?

## Resolved Questions

- **Download format:** "Download All" for carousels will produce a ZIP archive.
