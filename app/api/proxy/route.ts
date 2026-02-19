import { NextRequest, NextResponse } from "next/server";

function isAllowedProxyUrl(value: string): boolean {
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
