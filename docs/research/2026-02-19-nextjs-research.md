# Next.js Research for Instagram Post Downloader

**Date:** 2026-02-19
**Next.js Version:** 16.x (latest stable as of February 2026), documentation referenced at v16.1.6
**Status:** Complete

---

## Table of Contents

1. [Summary](#1-summary)
2. [Version Information](#2-version-information)
3. [API Route Handlers (App Router)](#3-api-route-handlers-app-router)
4. [Streaming Responses and Proxy Downloads](#4-streaming-responses-and-proxy-downloads)
5. [Server Actions vs API Routes](#5-server-actions-vs-api-routes)
6. [Generating and Serving ZIP Files](#6-generating-and-serving-zip-files)
7. [Best Practices for a Personal-Use App](#7-best-practices-for-a-personal-use-app)
8. [Project Structure Conventions](#8-project-structure-conventions)
9. [Recommended Architecture for This Project](#9-recommended-architecture-for-this-project)
10. [References](#10-references)

---

## 1. Summary

Next.js (currently at v16.1.6) provides everything needed for this Instagram downloader as a single full-stack project. The App Router's **Route Handlers** replace the older Pages Router API routes and are built on Web Standard `Request`/`Response` APIs. They support all HTTP methods, streaming binary data, and returning arbitrary content types including ZIP archives. For a personal-use app running on localhost, the architecture is straightforward: a React frontend for the UI with Route Handlers as the backend API layer. No authentication, rate limiting, or deployment concerns are needed.

---

## 2. Version Information

- **Next.js 16.x** is the latest stable release (October 2025+). The official documentation is at v16.1.6 as of February 2026.
- **Next.js 15** (October 2024) introduced breaking changes: `params` became async (Promises), GET Route Handlers are no longer cached by default, and React 19 support was added.
- **Next.js 16** (October 2025) added Cache Components and further App Router maturity.
- The App Router is now the undisputed default. There is no reason to use the Pages Router for new projects.

### Key Version Constraints

- `context.params` is now a `Promise` and must be `await`ed (changed in v15.0.0-RC).
- GET Route Handlers are **not cached** by default (changed in v15). You can opt in with `export const dynamic = 'force-static'`.
- `cookies()` and `headers()` from `next/headers` are now async and must be `await`ed.

---

## 3. API Route Handlers (App Router)

### 3.1 Convention

Route Handlers are defined in `route.ts` (or `route.js`) files inside the `app` directory. They are typically placed under `app/api/` by convention, but can be nested anywhere in `app/`. A `route.ts` file **cannot** exist at the same segment level as a `page.tsx`.

```
app/
  api/
    instagram/
      route.ts        -> handles /api/instagram
    download/
      route.ts        -> handles /api/download
    zip/
      route.ts        -> handles /api/zip
```

### 3.2 Basic Structure

Export named functions matching HTTP methods (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`):

```typescript
// app/api/instagram/route.ts
import { type NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const { url } = await request.json()

  // Fetch external data server-side
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  })
  const html = await response.text()

  // Parse and extract data...
  const postData = parseInstagramData(html)

  return Response.json(postData)
}
```

### 3.3 Key Features for This Project

**Fetching external data server-side:**
Route Handlers run on the server (Node.js runtime by default). They can use `fetch()` to retrieve external pages, bypassing CORS restrictions that would block browser-side requests.

```typescript
export async function POST(request: NextRequest) {
  const { url } = await request.json()

  // Server-side fetch - no CORS issues
  const igResponse = await fetch(url, {
    headers: {
      'User-Agent': '...',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })

  if (!igResponse.ok) {
    return Response.json(
      { error: 'Failed to fetch Instagram page' },
      { status: igResponse.status }
    )
  }

  const html = await igResponse.text()
  return Response.json({ html })
}
```

**Query parameters:**
Use `NextRequest` for convenient query parameter access:

```typescript
import { type NextRequest } from 'next/server'

export function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const url = searchParams.get('url')
  // /api/instagram?url=https://instagram.com/p/abc123
}
```

**Dynamic route segments:**
For parameterized endpoints, use folder-based dynamic segments:

```
app/api/download/[mediaId]/route.ts
```

```typescript
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  const { mediaId } = await params
  // Use mediaId to look up and proxy the download
}
```

### 3.4 Request and Response APIs

Route Handlers use the Web Standard `Request` and `Response` APIs, extended by Next.js with `NextRequest` and `NextResponse`:

```typescript
// Reading request body
const body = await request.json()        // JSON body
const formData = await request.formData() // Form data
const text = await request.text()         // Raw text

// Returning responses
return Response.json({ data })                    // JSON response
return new Response('text', { status: 200 })       // Text response
return new Response(binaryBuffer, {                // Binary response
  headers: {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': 'attachment; filename="photo.jpg"',
  },
})
```

### 3.5 Runtime Configuration

Route Handlers run in the Node.js runtime by default. This is the correct choice for this project because it needs full Node.js APIs (file system, Buffer, streams). The Edge runtime is available but has limited Node.js API access and is not needed here.

```typescript
// Explicitly set (default, not required)
export const runtime = 'nodejs'
```

---

## 4. Streaming Responses and Proxy Downloads

### 4.1 Proxying Media Downloads

The core pattern for proxying Instagram media through the Next.js server: fetch the media from Instagram's CDN and pipe it back to the client with appropriate headers.

**Simple in-memory approach (suitable for images):**

```typescript
// app/api/download/route.ts
import { type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const mediaUrl = request.nextUrl.searchParams.get('url')
  if (!mediaUrl) {
    return Response.json({ error: 'Missing url parameter' }, { status: 400 })
  }

  // Fetch media from Instagram CDN
  const mediaResponse = await fetch(mediaUrl)

  if (!mediaResponse.ok) {
    return Response.json({ error: 'Failed to fetch media' }, { status: 502 })
  }

  // Get the binary data
  const buffer = await mediaResponse.arrayBuffer()

  // Determine filename and content type
  const contentType = mediaResponse.headers.get('content-type') || 'application/octet-stream'
  const extension = contentType.includes('video') ? 'mp4' : 'jpg'
  const filename = `instagram-media.${extension}`

  return new Response(buffer, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.byteLength.toString(),
    },
  })
}
```

### 4.2 Streaming Approach (for large files / videos)

For larger files (videos), streaming avoids loading the entire file into memory:

**Using Web Standard ReadableStream:**

```typescript
// app/api/download/route.ts
export async function GET(request: NextRequest) {
  const mediaUrl = request.nextUrl.searchParams.get('url')
  if (!mediaUrl) {
    return Response.json({ error: 'Missing url parameter' }, { status: 400 })
  }

  const mediaResponse = await fetch(mediaUrl)
  if (!mediaResponse.ok || !mediaResponse.body) {
    return Response.json({ error: 'Failed to fetch media' }, { status: 502 })
  }

  const contentType = mediaResponse.headers.get('content-type') || 'application/octet-stream'
  const contentLength = mediaResponse.headers.get('content-length')

  const headers: HeadersInit = {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="instagram-media.mp4"`,
  }

  if (contentLength) {
    headers['Content-Length'] = contentLength
  }

  // Pass through the ReadableStream directly
  return new Response(mediaResponse.body, { headers })
}
```

This is the most efficient approach. The `fetch()` response body is already a `ReadableStream`, so it can be passed directly to the `Response` constructor. Data flows from Instagram's CDN through the server to the client without buffering the entire file in memory.

### 4.3 Converting Node.js Streams to Web Streams

If you need to work with Node.js streams (e.g., from the file system or a library that produces Node streams), convert them to Web `ReadableStream`:

```typescript
// Helper: Convert async iterator to ReadableStream
function iteratorToStream(iterator: AsyncIterableIterator<Uint8Array>): ReadableStream {
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await iterator.next()
      if (done) {
        controller.close()
      } else {
        controller.enqueue(value)
      }
    },
  })
}

// Helper: Convert Node.js ReadStream to async iterator
async function* nodeStreamToIterator(stream: NodeJS.ReadableStream) {
  for await (const chunk of stream) {
    yield new Uint8Array(chunk as Buffer)
  }
}

// Combined: Node stream -> Web ReadableStream
function streamNodeToWeb(nodeStream: NodeJS.ReadableStream): ReadableStream {
  return iteratorToStream(nodeStreamToIterator(nodeStream))
}
```

**Alternatively**, in modern Node.js (v16.5+), you can use the built-in conversion:

```typescript
import { Readable } from 'node:stream'

// Node.js Readable -> Web ReadableStream
const webStream = Readable.toWeb(nodeReadable)
return new Response(webStream)
```

Or with `fs.open` (Node.js 20+):

```typescript
import fs from 'node:fs/promises'

const fileHandle = await fs.open(filePath)
const stream = fileHandle.readableWebStream({ type: 'bytes' })
return new Response(stream)
```

---

## 5. Server Actions vs API Routes

### 5.1 What Are Server Actions?

Server Actions are async functions marked with `"use server"` that run on the server. They are designed for **mutations** (creating, updating, deleting data) and behave like auto-generated POST endpoints. You call them like regular functions from client components.

```typescript
// app/actions.ts
'use server'

export async function submitForm(formData: FormData) {
  const name = formData.get('name')
  // Process on server...
}
```

### 5.2 Key Differences

| Aspect | API Route Handlers | Server Actions |
|---|---|---|
| **HTTP Methods** | GET, POST, PUT, DELETE, etc. | POST only (always) |
| **URL** | Explicit, predictable (`/api/...`) | Auto-generated, encrypted |
| **Caching** | GET can be cached | Never cached |
| **Data Fetching** | Excellent for reads (GET) | Not recommended for reads |
| **Binary Responses** | Full control over Response | Return values only (serializable) |
| **Streaming** | Full streaming support | No streaming of binary data |
| **External Clients** | Callable from anywhere | Only from your Next.js app |
| **Use Case** | APIs, proxies, file downloads | Form submissions, mutations |

### 5.3 Recommendation for This Project: Use API Route Handlers

For an Instagram downloader, **API Route Handlers are the correct choice** for all server-side operations:

1. **Fetching Instagram pages** requires a GET or POST endpoint that returns parsed JSON data. Server Actions are not designed for data fetching and would result in repeated requests and slower UX.

2. **Proxying media downloads** requires returning binary data (images, videos) with custom headers (`Content-Disposition`, `Content-Type`). Server Actions can only return serializable values -- they cannot return a binary stream or set response headers.

3. **ZIP file generation** requires streaming binary data back to the client. This is only possible with Route Handlers.

4. **Server Actions would be appropriate** only if the app had mutation operations (e.g., saving downloads to a database, managing bookmarks). The current spec has no mutations.

### 5.4 When You Might Use Both

If the app later adds features like saving favorite posts or managing a download history, Server Actions could handle those mutations while Route Handlers continue to handle data fetching and downloads. The official recommendation is to share core logic in a "Data Access Layer":

```typescript
// lib/instagram.ts (shared logic)
export async function fetchInstagramPost(url: string) { /* ... */ }

// app/api/instagram/route.ts (API route)
export async function POST(request: NextRequest) {
  const { url } = await request.json()
  return Response.json(await fetchInstagramPost(url))
}

// app/actions.ts (Server Action, if needed later)
'use server'
export async function savePost(url: string) {
  const post = await fetchInstagramPost(url)
  await db.posts.save(post)
}
```

---

## 6. Generating and Serving ZIP Files

### 6.1 Library Options

| Library | Approach | Pros | Cons |
|---|---|---|---|
| **JSZip** | In-memory ZIP creation | Simple API, well-documented, works in Node and browser | Entire ZIP must fit in memory |
| **adm-zip** | In-memory ZIP creation | Simple, TypeScript types available | Entire ZIP must fit in memory |
| **archiver** | Streaming ZIP creation | Memory-efficient, supports large archives | More complex API, Node.js only |

**Recommendation:** Use **JSZip** for this project. Instagram carousel posts typically contain 2-10 images/videos. Even at high resolution, the total payload is manageable in memory (a few hundred MB at most). JSZip's API is simpler and well-suited for this use case.

### 6.2 Server-Side ZIP Generation with JSZip

```typescript
// app/api/zip/route.ts
import { type NextRequest } from 'next/server'
import JSZip from 'jszip'

export async function POST(request: NextRequest) {
  const { mediaItems } = await request.json()
  // mediaItems: Array<{ url: string, filename: string, type: string }>

  const zip = new JSZip()

  // Fetch all media files in parallel
  const fetchPromises = mediaItems.map(async (item: {
    url: string
    filename: string
    type: string
  }) => {
    const response = await fetch(item.url)
    if (!response.ok) {
      throw new Error(`Failed to fetch ${item.filename}`)
    }
    const buffer = await response.arrayBuffer()
    zip.file(item.filename, buffer)
  })

  await Promise.all(fetchPromises)

  // Generate the ZIP as a Node.js Buffer
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

  return new Response(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="instagram-post.zip"',
      'Content-Length': zipBuffer.byteLength.toString(),
    },
  })
}
```

### 6.3 Client-Side Download Trigger

```typescript
// In a Client Component
async function handleDownloadAll(mediaItems: MediaItem[]) {
  const response = await fetch('/api/zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaItems }),
  })

  if (!response.ok) {
    throw new Error('Failed to generate ZIP')
  }

  // Convert response to blob and trigger download
  const blob = await response.blob()
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'instagram-post.zip'
  link.click()
  window.URL.revokeObjectURL(url)
}
```

### 6.4 Alternative: Streaming ZIP with Archiver

For very large files (unlikely for Instagram posts, but good to know):

```typescript
// app/api/zip/route.ts
import archiver from 'archiver'
import { PassThrough } from 'node:stream'
import { Readable } from 'node:stream'

export async function POST(request: NextRequest) {
  const { mediaItems } = await request.json()

  const archive = archiver('zip', { zlib: { level: 5 } })
  const passthrough = new PassThrough()
  archive.pipe(passthrough)

  // Add files to the archive
  for (const item of mediaItems) {
    const response = await fetch(item.url)
    const buffer = Buffer.from(await response.arrayBuffer())
    archive.append(buffer, { name: item.filename })
  }

  archive.finalize()

  // Convert Node stream to Web ReadableStream
  const webStream = Readable.toWeb(passthrough) as ReadableStream

  return new Response(webStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="instagram-post.zip"',
    },
  })
}
```

---

## 7. Best Practices for a Personal-Use App

### 7.1 No Authentication Needed

For a localhost-only personal tool:
- No auth middleware, session management, or login flows.
- No CSRF protection concerns (not exposed to the internet).
- No rate limiting on API routes.
- No need for environment-variable secrets.

### 7.2 Error Handling

Even for personal use, good error handling improves the development experience:

```typescript
export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json()

    if (!url || !url.includes('instagram.com')) {
      return Response.json(
        { error: 'Invalid Instagram URL' },
        { status: 400 }
      )
    }

    const data = await fetchInstagramPost(url)
    return Response.json(data)

  } catch (error) {
    console.error('Instagram fetch error:', error)
    return Response.json(
      { error: 'Failed to fetch post. Instagram may have changed their page structure.' },
      { status: 500 }
    )
  }
}
```

### 7.3 TypeScript

Use TypeScript throughout. Define interfaces for Instagram data structures:

```typescript
// types/instagram.ts
export interface InstagramMediaItem {
  url: string
  type: 'image' | 'video'
  width: number
  height: number
  thumbnailUrl?: string
}

export interface InstagramPost {
  shortcode: string
  caption?: string
  timestamp: string
  mediaItems: InstagramMediaItem[]
  ownerUsername: string
}
```

### 7.4 Keep It Simple

- No database -- all operations are stateless fetch-and-return.
- No external state management library -- React state and Server Components are sufficient.
- No deployment configuration -- `next dev` for development is all that is needed.
- Minimal dependencies -- only add libraries when truly needed (JSZip for ZIP generation).

### 7.5 Environment Variables

Even though no secrets are needed for the core functionality, use `.env.local` for any configuration:

```
# .env.local
# Optional: custom user agent for Instagram requests
INSTAGRAM_USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
```

Access in Route Handlers with `process.env.INSTAGRAM_USER_AGENT`.

---

## 8. Project Structure Conventions

### 8.1 Official Conventions (Next.js 16)

Next.js is **unopinionated** about project organization but provides these structural features:

- **`app/` directory:** Contains all routes, layouts, and API endpoints.
- **`public/` directory:** Static assets served at `/`.
- **`src/` directory (optional):** Wraps `app/` to separate application code from config files.
- **Private folders (`_folder`):** Prefixed with underscore, excluded from routing.
- **Route groups (`(folder)`):** Parenthesized folders are organizational only, excluded from URL paths.

### 8.2 File Conventions

| File | Purpose |
|---|---|
| `layout.tsx` | Shared UI wrapper for a route segment and its children |
| `page.tsx` | Unique UI for a route, makes the route publicly accessible |
| `loading.tsx` | Loading UI (Suspense boundary) |
| `error.tsx` | Error UI (Error boundary) |
| `not-found.tsx` | Not found UI |
| `route.ts` | API endpoint (cannot coexist with `page.tsx` at the same level) |

### 8.3 Recommended Structure for This Project

For a small, focused personal-use app, the "project files outside of app" strategy is cleanest. This keeps `app/` purely for routing and puts all shared code in top-level folders:

```
ig-downloader/
├── app/
│   ├── layout.tsx              # Root layout (html, body, global styles)
│   ├── page.tsx                # Main page: URL input + results display
│   ├── loading.tsx             # (optional) Global loading state
│   ├── error.tsx               # (optional) Global error boundary
│   └── api/
│       ├── instagram/
│       │   └── route.ts        # POST: fetch + parse Instagram post
│       ├── download/
│       │   └── route.ts        # GET: proxy single media download
│       └── zip/
│           └── route.ts        # POST: generate + serve ZIP archive
│
├── components/
│   ├── url-input.tsx           # URL input form (Client Component)
│   ├── post-preview.tsx        # Post preview display
│   ├── media-card.tsx          # Individual media item card
│   └── download-button.tsx     # Download trigger button
│
├── lib/
│   ├── instagram.ts            # Instagram page fetching + parsing logic
│   ├── media.ts                # Media URL extraction + resolution logic
│   └── zip.ts                  # ZIP generation utility
│
├── types/
│   └── instagram.ts            # TypeScript interfaces
│
├── public/                     # (empty or favicon only)
├── next.config.ts
├── package.json
├── tsconfig.json
└── .env.local
```

### 8.4 Why This Structure

1. **`app/` is routing only.** Pages and API routes live here. No business logic.
2. **`lib/` holds core logic.** Instagram parsing, media handling, and ZIP generation are reusable across multiple routes and can be tested independently.
3. **`components/` holds UI components.** Separated from routing for clarity.
4. **`types/` holds TypeScript interfaces.** Shared across the entire codebase.
5. **Flat API structure.** Three endpoints with clear, single responsibilities:
   - `/api/instagram` -- fetch and parse a post
   - `/api/download` -- proxy a single media file
   - `/api/zip` -- bundle multiple media files into a ZIP

### 8.5 Alternative: Colocation Strategy

For an even simpler approach, colocate related files within route segments using private folders:

```
app/
├── layout.tsx
├── page.tsx
├── _components/
│   ├── url-input.tsx
│   ├── post-preview.tsx
│   └── media-card.tsx
├── _lib/
│   ├── instagram.ts
│   └── types.ts
└── api/
    ├── instagram/route.ts
    ├── download/route.ts
    └── zip/route.ts
```

Private folders (`_components`, `_lib`) are ignored by the router. This keeps everything in one directory tree but is slightly less conventional for shared utilities.

---

## 9. Recommended Architecture for This Project

### 9.1 Data Flow

```
[Browser Client]
      |
      | POST /api/instagram  { url: "https://instagram.com/p/abc123" }
      v
[Route Handler: /api/instagram/route.ts]
      |
      | fetch("https://instagram.com/p/abc123")
      v
[Instagram Server] -> HTML with embedded JSON
      |
      | Parse JSON, extract media URLs
      v
[Route Handler returns]  { post: { mediaItems: [...], caption: "..." } }
      |
      v
[Browser Client] -- renders preview UI
      |
      | (User clicks Download)
      | GET /api/download?url=<instagram-cdn-url>&filename=photo1.jpg
      v
[Route Handler: /api/download/route.ts]
      |
      | fetch(instagram-cdn-url)
      v
[Instagram CDN] -> binary image/video data
      |
      | Stream/pipe through with Content-Disposition header
      v
[Browser] -- saves file

      OR (for carousel "Download All")

      | POST /api/zip  { mediaItems: [...] }
      v
[Route Handler: /api/zip/route.ts]
      |
      | fetch all media URLs in parallel
      | Pack into JSZip archive
      v
[Browser] -- saves .zip file
```

### 9.2 API Design

**`POST /api/instagram`**
- Input: `{ url: string }`
- Output: `{ post: InstagramPost }` or `{ error: string }`
- Purpose: Fetch an Instagram page server-side, parse embedded JSON, return structured post data.

**`GET /api/download?url=<encoded-url>&filename=<name>`**
- Input: Query parameters `url` (Instagram CDN URL) and `filename`
- Output: Binary stream with `Content-Disposition: attachment`
- Purpose: Proxy a single media file download to avoid CORS.

**`POST /api/zip`**
- Input: `{ mediaItems: Array<{ url: string, filename: string }> }`
- Output: Binary ZIP with `Content-Disposition: attachment`
- Purpose: Fetch multiple media files, bundle into ZIP, return for download.

### 9.3 Client-Server Boundary

- **Server Components** (`page.tsx`): Can render the initial UI shell. Since the app is interactive (paste URL, click buttons), most of the active UI will be Client Components.
- **Client Components** (`'use client'`): The URL input form, post preview with download buttons, and download trigger logic.
- **Route Handlers**: All external data fetching (Instagram pages, CDN media) and binary file operations (proxying, ZIP generation).

### 9.4 Key Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Route type | Route Handlers (not Server Actions) | Need GET support, binary responses, streaming, custom headers |
| ZIP library | JSZip | Simple API, in-memory is fine for 2-10 carousel items |
| Media proxy | Stream-through with `response.body` passthrough | Memory-efficient for videos |
| Runtime | Node.js (default) | Need full Node APIs (Buffer, streams) |
| State management | React `useState` | Simple app, no external state library needed |
| Styling | Tailwind CSS (or CSS Modules) | Fast development, ships with `create-next-app` |

---

## 10. References

### Official Next.js Documentation
- [Route Handlers (Getting Started)](https://nextjs.org/docs/app/getting-started/route-handlers) -- v16.1.6
- [route.js API Reference](https://nextjs.org/docs/app/api-reference/file-conventions/route) -- v16.1.6
- [Building APIs with Next.js](https://nextjs.org/blog/building-apis-with-nextjs) -- February 2025
- [Project Structure](https://nextjs.org/docs/app/getting-started/project-structure) -- v16.1.6
- [Next.js 15 Release Blog](https://nextjs.org/blog/next-15)

### Community Resources
- [Server Actions vs API Routes](https://www.danielfullstack.com/article/server-actions-vs-api-routes-in-next-js)
- [Server Actions vs Route Handlers (MakerKit)](https://makerkit.dev/blog/tutorials/server-actions-vs-route-handlers)
- [How to Stream Files from Next.js Route Handlers](https://www.ericburel.tech/blog/nextjs-stream-files)
- [Download ZIP Files in Next.js (CodeConcisely)](https://www.codeconcisely.com/posts/nextjs-download-zip-file/)
- [Generate ZIP with File Links (Mridul)](https://www.mridul.tech/blogs/how-to-generate-zip-with-file-links-in-next-js-and-react-js)
- [GitHub Discussion: Archiver with Route Handlers](https://github.com/vercel/next.js/discussions/58044)
- [Server Actions vs API Routes Discussion](https://github.com/vercel/next.js/discussions/72919)

### Libraries
- [JSZip](https://stuk.github.io/jszip/) -- ZIP file generation
- [adm-zip](https://www.npmjs.com/package/adm-zip) -- Alternative ZIP library
- [archiver](https://www.npmjs.com/package/archiver) -- Streaming ZIP creation
