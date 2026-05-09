import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveConfig } from "../../src/config.js";
import { truncateText } from "../../src/http.js";
import { createFetchProvider, createSearchProvider } from "../../src/providers/index.js";
import type { FetchProviderName, SearchProviderName } from "../../src/types.js";

const DEFAULT_FETCH_LIMIT = 30_000;
const MULTI_FETCH_LIMIT = 8_000;

type CachedPage = {
  provider: FetchProviderName;
  cacheKey: string;
  url: string;
  title?: string;
  content: string;
  format: string;
  metadata?: Record<string, unknown>;
  fetchedAt: number;
};

const fetchCache = new Map<string, CachedPage>();

export default function (pi: ExtensionAPI) {
  pi.registerFlag("web-provider-search", {
    description: "Temporary pi-web-kit search provider override (exa_mcp, exa, tinyfish, brave, firecrawl)",
    type: "string",
  });
  pi.registerFlag("web-provider-fetch", {
    description: "Temporary pi-web-kit fetch provider override (exa_mcp, exa, tinyfish, markdown_new, firecrawl)",
    type: "string",
  });

  const startupConfig = resolveConfig({
    providerSearch: pi.getFlag("web-provider-search"),
    providerFetch: pi.getFlag("web-provider-fetch"),
  });

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: buildSearchDescription(startupConfig.provider_search),
    promptSnippet: "Find current or external web information.",
    promptGuidelines: ["Use web_search to find current or external web information."],
    parameters: buildSearchSchema(startupConfig.provider_search),
    async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
      const params = rawParams as Record<string, any>;
      const queries = normalizeQueries(params);
      if (queries.length === 0) throw new Error("web_search requires query or queries.");

      const config = resolveConfig({ providerSearch: pi.getFlag("web-provider-search") }, ctx.cwd);
      const provider = createSearchProvider(config);
      const grouped = [];
      for (const query of queries) {
        const result = await provider.search({ ...params, query }, signal);
        grouped.push({ query, results: result.results });
      }
      const result = { provider: config.provider_search, queries: grouped };
      const text = truncateText(JSON.stringify(result, null, 2));
      return { content: [{ type: "text", text }], details: boundedDetails(result) };
    },
  });

  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description: buildFetchDescription(startupConfig.provider_fetch),
    promptSnippet: "Read page content from URL(s), with offset/limit for long pages.",
    promptGuidelines: ["Use web_fetch when the user provides URLs or asks to read page content."],
    parameters: buildFetchSchema(startupConfig.provider_fetch),
    async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
      const params = rawParams as Record<string, any>;
      const urls = normalizeUrls(params);
      if (urls.length === 0) throw new Error("web_fetch requires url or urls.");
      if (urls.length > 1 && (params.offset != null || params.limit != null)) {
        throw new Error("web_fetch offset/limit range reads require a single url, not urls.");
      }

      const config = resolveConfig({ providerFetch: pi.getFlag("web-provider-fetch") }, ctx.cwd);
      const result = await fetchWithCache(config.provider_fetch, params, urls, signal, config);
      const text = truncateText(JSON.stringify(result, null, 2));
      return { content: [{ type: "text", text }], details: boundedDetails(result) };
    },
  });
}

function buildSearchSchema(provider: SearchProviderName) {
  const props: Record<string, any> = {
    query: Type.Optional(Type.String({ description: "Single search query" })),
    queries: Type.Optional(Type.Array(Type.String(), { description: "Multiple related search queries" })),
    numResults: Type.Optional(Type.Number({ description: "Results per query" })),
  };
  if (provider === "exa") Object.assign(props, {
    includeDomains: Type.Optional(Type.Array(Type.String())),
    excludeDomains: Type.Optional(Type.Array(Type.String())),
    startPublishedDate: Type.Optional(Type.String()),
    endPublishedDate: Type.Optional(Type.String()),
    startCrawlDate: Type.Optional(Type.String()),
    endCrawlDate: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
    category: Type.Optional(Type.String()),
  });
  if (provider === "tinyfish") Object.assign(props, {
    page: Type.Optional(Type.Number()),
  });
  if (provider === "brave") Object.assign(props, {
    country: Type.Optional(Type.String()),
    searchLang: Type.Optional(Type.String()),
    uiLang: Type.Optional(Type.String()),
    safesearch: Type.Optional(Type.String()),
    freshness: Type.Optional(Type.String()),
    maxUrls: Type.Optional(Type.Number()),
  });
  if (provider === "firecrawl") Object.assign(props, {
    location: Type.Optional(Type.String()),
    country: Type.Optional(Type.String()),
    includeDomains: Type.Optional(Type.Array(Type.String())),
    excludeDomains: Type.Optional(Type.Array(Type.String())),
    categories: Type.Optional(Type.Array(Type.String())),
    tbs: Type.Optional(Type.String()),
    scrape: Type.Optional(Type.Boolean({ description: "Enable scrape-on-search when supported" })),
  });
  return Type.Object(props);
}

function buildFetchSchema(provider: FetchProviderName) {
  const props: Record<string, any> = {
    url: Type.Optional(Type.String({ description: "Single URL" })),
    urls: Type.Optional(Type.Array(Type.String(), { description: "Multiple URLs" })),
    offset: Type.Optional(Type.Number({ description: "Character offset for cached/ranged reads" })),
    limit: Type.Optional(Type.Number({ description: "Maximum characters to return" })),
    refresh: Type.Optional(Type.Boolean({ description: "Refetch even if cached" })),
  };
  if (provider === "tinyfish") Object.assign(props, {
    format: Type.Optional(Type.Union([Type.Literal("markdown"), Type.Literal("html"), Type.Literal("json")])),
    links: Type.Optional(Type.Boolean()),
    imageLinks: Type.Optional(Type.Boolean()),
  });
  if (provider === "markdown_new") Object.assign(props, {
    method: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("ai"), Type.Literal("browser")])),
    retainImages: Type.Optional(Type.Boolean()),
  });
  if (provider === "firecrawl") Object.assign(props, {
    formats: Type.Optional(Type.Array(Type.Object({ type: Type.String() }, { additionalProperties: true }))),
    onlyMainContent: Type.Optional(Type.Boolean()),
    waitFor: Type.Optional(Type.Number()),
    mobile: Type.Optional(Type.Boolean()),
    location: Type.Optional(Type.String()),
    maxAge: Type.Optional(Type.Number()),
  });
  return Type.Object(props);
}

function buildSearchDescription(provider: SearchProviderName): string {
  return `Search the web with ${provider}. Use query or queries; returns compact results grouped by query.`;
}

function buildFetchDescription(provider: FetchProviderName): string {
  return `Fetch URL content with ${provider}. Results are cached by URL; use offset/limit to read long pages in chunks.`;
}

function normalizeQueries(params: Record<string, any>): string[] {
  const raw = Array.isArray(params.queries) ? params.queries : params.query ? [params.query] : [];
  return [...new Set(raw.map((q) => String(q).trim()).filter(Boolean))];
}

function normalizeUrls(params: Record<string, any>): string[] {
  const raw = [...(Array.isArray(params.urls) ? params.urls : []), ...(params.url ? [params.url] : [])];
  return [...new Set(raw.map((url) => String(url).trim()).filter(Boolean))];
}

async function fetchWithCache(providerName: FetchProviderName, params: Record<string, any>, urls: string[], signal: AbortSignal | undefined, config: any) {
  const provider = createFetchProvider(config);
  const offset = Math.max(0, Number(params.offset ?? 0));
  const defaultLimit = urls.length > 1 ? MULTI_FETCH_LIMIT : DEFAULT_FETCH_LIMIT;
  const limit = Math.max(1, Number(params.limit ?? defaultLimit));
  const refresh = params.refresh === true;

  const pages = new Map<string, { page?: CachedPage; cached: boolean; refreshed: boolean; error?: string }>();
  const missing: string[] = [];
  for (const url of urls) {
    const cacheKey = buildCacheKey(providerName, url, params);
    const cached = fetchCache.get(cacheKey);
    if (cached && !refresh) pages.set(url, { page: cached, cached: true, refreshed: false });
    else missing.push(url);
  }

  if (missing.length > 0) {
    const fetched = await provider.fetch({ ...params, url: undefined, urls: missing }, signal);
    for (const item of fetched.results) {
      const cacheKey = buildCacheKey(providerName, item.url, params);
      if (item.error) {
        pages.set(item.url, { error: item.error, cached: false, refreshed: refresh });
        continue;
      }
      const page: CachedPage = {
        provider: providerName,
        cacheKey,
        url: item.url,
        title: item.title,
        content: item.content ?? "",
        format: item.format ?? "markdown",
        metadata: item.metadata,
        fetchedAt: Date.now(),
      };
      fetchCache.set(cacheKey, page);
      pages.set(item.url, { page, cached: false, refreshed: refresh });
    }
  }

  return { provider: providerName, results: urls.map((url) => {
    const entry = pages.get(url);
    if (!entry?.page) return { url, error: entry?.error ?? "No content returned." };
    return pageSlice(entry.page, offset, limit, entry.cached, entry.refreshed);
  }) };
}

function pageSlice(page: CachedPage, offset: number, limit: number, cached: boolean, refreshed: boolean) {
  const total = page.content.length;
  const content = page.content.slice(offset, offset + limit);
  return {
    url: page.url,
    title: page.title,
    content,
    format: page.format,
    cached,
    refreshed,
    cacheKey: page.cacheKey,
    range: { offset, limit, returned: content.length, total, truncated: offset + content.length < total },
  };
}

function buildCacheKey(provider: FetchProviderName, url: string, params: Record<string, any>): string {
  const canonical = canonicalUrl(url);
  const affecting: Record<string, unknown> = {};
  for (const key of Object.keys(params).sort()) {
    if (["url", "urls", "offset", "limit", "refresh"].includes(key)) continue;
    affecting[key] = params[key];
  }
  return `${provider}\0${JSON.stringify(affecting)}\0${canonical}`;
}

function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

function boundedDetails(value: unknown): unknown {
  const text = truncateText(JSON.stringify(value, null, 2));
  try { return JSON.parse(text); } catch { return { truncated: true, text }; }
}
