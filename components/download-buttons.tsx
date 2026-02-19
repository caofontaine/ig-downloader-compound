"use client";

interface DownloadButtonsProps {
  itemCount: number;
  onDownload: () => void;
  downloading: boolean;
  disabled: boolean;
}

export default function DownloadButtons({ itemCount, onDownload, downloading, disabled }: DownloadButtonsProps) {
  if (itemCount === 0) return null;

  const label = itemCount > 1 ? "Download ZIP" : "Download file";

  return (
    <button
      onClick={onDownload}
      disabled={disabled || downloading}
      className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
    >
      {downloading ? "Downloading..." : label}
    </button>
  );
}
