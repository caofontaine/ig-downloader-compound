"use client";

const POST_RE = /https?:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/[^/]+/i;

interface UrlInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  loading: boolean;
}

export default function UrlInput({ value, onChange, onSubmit, disabled, loading }: UrlInputProps) {
  const hasValue = value.trim().length > 0;
  const isValid = !hasValue || POST_RE.test(value.trim());
  const canSubmit = hasValue && isValid && !disabled;

  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Post URL
      </label>
      <div className="mt-2 flex gap-3">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) onSubmit();
          }}
          placeholder="https://www.instagram.com/p/..."
          className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
        />
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {loading ? "Fetching..." : "Get preview"}
        </button>
      </div>
      {hasValue && !isValid && (
        <p className="mt-2 text-xs font-medium text-rose-600">
          Enter a valid Instagram post, Reel, or IGTV URL.
        </p>
      )}
    </div>
  );
}
