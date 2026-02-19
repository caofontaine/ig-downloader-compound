# IG Vault — Instagram Media Downloader

## Overview

Personal-use Next.js web app for downloading Instagram posts, reels, and carousels at highest quality. Runs locally on `localhost:3000`.

## Tech Stack

- **Framework:** Next.js (App Router) with TypeScript
- **Styling:** Tailwind CSS
- **HTML parsing:** cheerio
- **ZIP streaming:** archiver

## Project Structure

- `app/page.tsx` — Main UI (single-page client component)
- `app/api/preview/route.ts` — POST: fetch + parse Instagram post metadata
- `app/api/download/route.ts` — POST: download single file or ZIP bundle
- `app/api/proxy/route.ts` — GET: proxy media URLs for thumbnail previews
- `lib/instagram.ts` — Multi-fallback Instagram scraping (no auth required)
- `lib/media.ts` — Image URL promotion, dimension probing, file size enrichment
- `lib/types.ts` — Shared TypeScript interfaces
- `components/` — React UI components

## Instagram Scraping Strategy

Uses a multi-fallback approach with **no authentication tokens or API keys**:

1. `?__a=1&__d=dis` magic parameters (JSON)
2. HTML page parsing (embedded `<script>` JSON)
3. Embed page parsing (`/embed/`)
4. OG meta tag extraction + legacy `/media/?size=l`

## Commands

```bash
npm run dev     # Start development server on localhost:3000
npm run build   # Production build
npm run lint    # Run ESLint
```

## Git Workflow

- Before making any commits, ensure a remote repository exists and is pushable. If no remote is configured (or the URL is invalid), create one with `gh repo create` first.

## Conventions

- Use `lib/` for shared utilities (not `utils/` or `helpers/`)
- API routes return `ApiResponse` type from `lib/types.ts`
- All Instagram fetches go through `lib/instagram.ts` — never call Instagram directly from routes
- Proxy all media URLs through `/api/proxy` to avoid CORS issues in the browser
