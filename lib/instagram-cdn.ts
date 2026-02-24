/**
 * Instagram CDN URL utilities: allowlist validation and efg tag decoding.
 * Centralised here so security-sensitive logic is discoverable in one place.
 */

export function isAllowedProxyUrl(value: string): boolean {
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

export function decodeEfgTag(url: string): string | null {
  try {
    const parsed = new URL(url);
    const efg = parsed.searchParams.get("efg");
    if (!efg) return null;
    const decoded = Buffer.from(decodeURIComponent(efg), "base64").toString("utf8");
    const payload = JSON.parse(decoded);
    const tag = payload?.vencode_tag;
    return typeof tag === "string" ? tag : null;
  } catch {
    return null;
  }
}
