import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import archiver from "archiver";
import { fetchPostMedia, normalizePostUrl, UpstreamError } from "@/lib/instagram";
import type { ApiResponse, MediaItem } from "@/lib/types";

export async function POST(request: NextRequest) {
  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ApiResponse>(
      { status: "error", items: [], error: "Invalid request body." },
      { status: 400 },
    );
  }

  if (!body.url || typeof body.url !== "string") {
    return NextResponse.json<ApiResponse>(
      { status: "error", items: [], error: "Post URL is required." },
      { status: 400 },
    );
  }

  try {
    normalizePostUrl(body.url);
  } catch (err) {
    return NextResponse.json<ApiResponse>(
      { status: "error", items: [], error: err instanceof Error ? err.message : "Invalid URL." },
      { status: 400 },
    );
  }

  try {
    const result = await fetchPostMedia(body.url);
    if (result.items.length === 0) {
      return NextResponse.json<ApiResponse>(
        { status: "error", items: [], error: "No media available for download." },
        { status: 400 },
      );
    }

    const filenames = buildFilenames(result.items, result.meta);

    // Single item: stream directly
    if (result.items.length === 1) {
      const item = result.items[0];
      const upstream = await fetch(item.url);
      if (!upstream.ok || !upstream.body) {
        return NextResponse.json<ApiResponse>(
          { status: "error", items: [], error: "Failed to fetch media for download." },
          { status: 502 },
        );
      }
      return new NextResponse(upstream.body, {
        headers: {
          "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
          "Content-Disposition": `attachment; filename="${filenames[0]}"`,
        },
      });
    }

    // Multiple items: stream as ZIP
    const zipName = buildZipName(result.meta);
    const archive = archiver("zip", { zlib: { level: 6 } });

    const stream = new ReadableStream({
      start(controller) {
        const nodeStream = new Readable({
          read() {},
        });

        archive.on("data", (chunk: Buffer) => {
          controller.enqueue(chunk);
        });
        archive.on("end", () => {
          controller.close();
        });
        archive.on("error", (err: Error) => {
          controller.error(err);
        });

        // Pipe is not used — we use event-based approach for Web Streams compatibility
        void nodeStream;

        (async () => {
          for (let i = 0; i < result.items.length; i++) {
            const item = result.items[i];
            const response = await fetch(item.url);
            if (!response.ok || !response.body) {
              archive.abort();
              return;
            }
            const nodeReadable = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
            archive.append(nodeReadable, { name: filenames[i] });
          }
          await archive.finalize();
        })();
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipName}"`,
      },
    });
  } catch (err) {
    if (err instanceof UpstreamError) {
      return NextResponse.json<ApiResponse>(
        { status: "error", items: [], error: err.message },
        { status: 502 },
      );
    }
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return NextResponse.json<ApiResponse>(
      { status: "error", items: [], error: message },
      { status: 500 },
    );
  }
}

function buildFilenames(items: MediaItem[], meta?: ApiResponse["meta"]): string[] {
  const username = safeSegment(meta?.username ?? "instagram");
  const dateOrCode = meta?.postTimestamp
    ? formatIsoTimestamp(meta.postTimestamp)
    : safeSegment(meta?.shortcode ?? "post");

  return items.map((item, index) => {
    const ext = getExtension(item.url, item.type);
    if (items.length === 1) {
      return `${username}_${dateOrCode}.${ext}`;
    }
    return `${username}_${dateOrCode}_${index + 1}.${ext}`;
  });
}

function buildZipName(meta?: ApiResponse["meta"]): string {
  const username = safeSegment(meta?.username ?? "instagram");
  const shortcode = safeSegment(meta?.shortcode ?? "post");
  return `${username}_post_${shortcode}.zip`;
}

function getExtension(url: string, type: "image" | "video"): string {
  try {
    const pathname = new URL(url).pathname;
    const segment = pathname.split("/").pop() ?? "";
    const ext = segment.split(".").pop();
    if (ext && ext.length <= 5) return ext;
  } catch { /* fall through */ }
  return type === "video" ? "mp4" : "jpg";
}

function safeSegment(value: string): string {
  const cleaned = value.replace(/\./g, "_").replace(/[^a-zA-Z0-9_-]+/g, "_");
  return cleaned.length > 0 ? cleaned : "instagram";
}

function formatIsoTimestamp(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `${date}T${time}.000Z`;
}
