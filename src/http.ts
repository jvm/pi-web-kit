const MAX_CHARS = 50_000;
const MAX_LINES = 2_000;

export function truncateText(text: string, maxChars = MAX_CHARS): string {
  const lines = text.split(/\r?\n/);
  const lineLimited = lines.length > MAX_LINES ? lines.slice(0, MAX_LINES).join("\n") + "\n[truncated: line limit]" : text;
  return lineLimited.length > maxChars ? lineLimited.slice(0, maxChars) + "\n[truncated: size limit]" : lineLimited;
}

export function truncateObject<T>(value: T): T {
  const json = JSON.stringify(value, null, 2);
  if (json.length <= MAX_CHARS) return value;
  return JSON.parse(truncateText(json).replace(/\n\[truncated:[\s\S]*$/, '"')) as T;
}

export async function requestJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${init.timeoutMs ?? 30000}ms`)), init.timeoutMs ?? 30000);
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
  try {
    const res = await fetch(url, { ...init, signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 1000)}`);
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function asSnippet(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value.filter(Boolean).join("\n").slice(0, 1000) || undefined;
  if (typeof value === "string") return value.slice(0, 1000) || undefined;
  return JSON.stringify(value).slice(0, 1000);
}

export function normalizeUrls(input: { url?: string; urls?: string[] }): string[] {
  const urls = [...(input.urls ?? []), ...(input.url ? [input.url] : [])].filter(Boolean);
  return [...new Set(urls)];
}
