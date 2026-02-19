import { NextRequest, NextResponse } from "next/server";
import { fetchPostMedia, normalizePostUrl, UpstreamError } from "@/lib/instagram";
import type { ApiResponse } from "@/lib/types";

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
    return NextResponse.json<ApiResponse>({
      status: "ok",
      items: result.items,
      error: null,
      meta: result.meta,
    });
  } catch (err) {
    if (err instanceof UpstreamError) {
      return NextResponse.json<ApiResponse>(
        { status: "error", items: [], error: err.message },
        { status: 502 },
      );
    }
    const message = err instanceof Error ? err.message : "Unexpected error.";
    const status = message.toLowerCase().includes("invalid") ? 400 : 500;
    return NextResponse.json<ApiResponse>(
      { status: "error", items: [], error: message },
      { status },
    );
  }
}
