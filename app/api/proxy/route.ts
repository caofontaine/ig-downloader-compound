import { NextRequest, NextResponse } from "next/server";
import { isAllowedProxyUrl } from "@/lib/instagram-cdn";

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return new NextResponse("Missing url parameter.", { status: 400 });
  }
  if (!isAllowedProxyUrl(rawUrl)) {
    return new NextResponse("Invalid url.", { status: 400 });
  }

  try {
    const upstream = await fetch(rawUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!upstream.ok || !upstream.body) {
      return new NextResponse("Failed to fetch media.", { status: 502 });
    }

    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
        "Cache-Control": "public, max-age=600",
      },
    });
  } catch {
    return new NextResponse("Failed to fetch media.", { status: 502 });
  }
}
