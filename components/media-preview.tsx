"use client";

import type { MediaItem, ApiResponse } from "@/lib/types";

interface MediaPreviewProps {
  items: MediaItem[];
  meta: ApiResponse["meta"] | null;
}

function formatBytes(value: number): string {
  if (!value) return "\u2014";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function formatResolution(width: number, height: number): string {
  if (!width || !height) return "Unknown";
  return `${width}\u00d7${height}`;
}

function buildProxySrc(rawUrl: string): string {
  if (!rawUrl) return "";
  return `/api/proxy?url=${encodeURIComponent(rawUrl)}`;
}

export default function MediaPreview({ items, meta }: MediaPreviewProps) {
  if (items.length === 0) return null;

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold text-slate-900">
          {items.length} {items.length === 1 ? "item" : "items"}
        </h3>
        {meta?.username && (
          <span className="text-sm text-slate-500">@{meta.username}</span>
        )}
      </div>
      {items.map((item, index) => (
        <div
          key={`${item.url}-${index}`}
          className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row"
        >
          <div className="relative h-40 w-full overflow-hidden rounded-xl bg-slate-100 sm:w-48 sm:shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={buildProxySrc(item.thumbnail || item.url)}
              alt={`Media ${index + 1}`}
              className="h-full w-full object-cover"
              loading="lazy"
            />
            {item.type === "video" && (
              <span className="absolute bottom-2 right-2 rounded-full bg-slate-900/80 px-3 py-1 text-xs font-semibold text-white">
                Video
              </span>
            )}
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 text-sm text-slate-600">
            <p className="font-semibold text-slate-800">
              Item {index + 1} &middot; {item.type === "video" ? "VIDEO" : "IMAGE"}
            </p>
            <p className="text-xs text-slate-500">
              {formatResolution(item.width, item.height)}
            </p>
            <p className="text-xs text-slate-500">
              Size: {formatBytes(item.filesize)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
