"use client";

import { useState } from "react";
import type { ApiResponse, MediaItem } from "@/lib/types";
import UrlInput from "@/components/url-input";
import MediaPreview from "@/components/media-preview";
import DownloadButtons from "@/components/download-buttons";

type Status = "idle" | "fetching" | "ready" | "error" | "downloading";

export default function Home() {
  const [url, setUrl] = useState("");
  const [items, setItems] = useState<MediaItem[]>([]);
  const [meta, setMeta] = useState<ApiResponse["meta"] | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const handleFetch = async () => {
    setStatus("fetching");
    setError(null);
    setItems([]);
    setMeta(null);

    try {
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = (await res.json()) as ApiResponse;
      if (!res.ok || data.status === "error") {
        setStatus("error");
        setError(data.error ?? "Something went wrong.");
        return;
      }
      setItems(data.items ?? []);
      setMeta(data.meta ?? null);
      setStatus("ready");
    } catch {
      setStatus("error");
      setError("Could not reach the server. Check your connection or try again.");
    }
  };

  const handleDownload = async () => {
    setStatus("downloading");
    setError(null);

    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!res.ok) {
        const data = (await res.json()) as ApiResponse;
        throw new Error(data.error ?? "Download failed.");
      }

      const blob = await res.blob();
      const header = res.headers.get("content-disposition");
      const fallbackName = items.length > 1 ? "instagram_bundle.zip" : "instagram_media";
      const filename = getFilenameFromHeader(header) ?? fallbackName;

      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);

      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Download failed.");
    }
  };

  const handleReset = () => {
    setUrl("");
    setItems([]);
    setMeta(null);
    setStatus("idle");
    setError(null);
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-brand-500 via-rose-400 to-amber-300" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900">IG Vault</h1>
            <p className="text-sm text-slate-500">Instagram Media Downloader</p>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <UrlInput
          value={url}
          onChange={setUrl}
          onSubmit={handleFetch}
          disabled={status === "fetching"}
          loading={status === "fetching"}
        />

        {status === "error" && error && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        {items.length > 0 && (
          <div className="mt-6 flex items-center gap-3">
            <DownloadButtons
              itemCount={items.length}
              onDownload={handleDownload}
              downloading={status === "downloading"}
              disabled={status !== "ready"}
            />
            <button
              onClick={handleReset}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              Start over
            </button>
          </div>
        )}
      </section>

      {items.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <MediaPreview items={items} meta={meta} />
        </section>
      )}

      <footer className="text-center text-xs text-slate-400">
        Personal use only. Respect content creators&apos; rights.
      </footer>
    </div>
  );
}

function getFilenameFromHeader(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match?.[1] ?? null;
}
