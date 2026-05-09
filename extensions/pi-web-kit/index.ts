import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fetchCache, type CachedPage } from "../../src/cache.js";
import { resolveConfig } from "../../src/config.js";
import { DEFAULT_FETCH_LIMIT, DEFAULT_NUM_RESULTS, MAX_LIMIT, MAX_NUM_RESULTS, MAX_OFFSET, MAX_QUERY_COUNT, MAX_URL_COUNT, MULTI_FETCH_LIMIT } from "../../src/limits.js";
import { truncateText } from "../../src/http.js";
import { createFetchProvider, createSearchProvider } from "../../src/providers/index.js";
import type { FetchProviderName, SearchProviderName, WebFetchResult } from "../../src/types.js";
import { canonicalWebUrl, normalizeUrlInput, urlsMatch } from "../../src/urls.js";

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
      const numResults = parseInteger(params.numResults, DEFAULT_NUM_RESULTS, "numResults", 1, MAX_NUM_RESULTS);
      if (queries.length === 0) throw new Error("web_search requires query or queries.");

      const config = resolveConfig({ providerSearch: pi.getFlag("web-provider-search") }, ctx.cwd);
      assertProviderUnchanged("web_search", startupConfig.provider_search, config.provider_search);
      const provider = createSearchProvider(config);
      const grouped = [];
      for (const query of queries) {
        const result = await provider.search({ ...params, query, numResults }, signal);
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
      assertProviderUnchanged("web_fetch", startupConfig.provider_fetch, config.provider_fetch);
      const result = await fetchWithCache(config.provider_fetch, params, urls, signal, config);
      const text = truncateText(JSON.stringify(result, null, 2));
      return { content: [{ type: "text", text }], details: boundedDetails(result) };
    },
  });
}

const int = (description: string, min: number, max?: number) => Type.Integer({ description, minimum: min, ...(max == null ? {} : { maximum: max }) });

export function buildSearchSchema(provider: SearchProviderName) {
  const props: Record<string, any> = {
    query: Type.Optional(Type.String({ description: "Single search query" })),
    queries: Type.Optional(Type.Array(Type.String(), { description: `Multiple related search queries (max ${MAX_QUERY_COUNT})`, maxItems: MAX_QUERY_COUNT })),
    numResults: Type.Optional(int("Results per query", 1, MAX_NUM_RESULTS)),
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
  if (provider === "tinyfish") Object.assign(props, { page: Type.Optional(int("Result page", 1, 10)) });
  if (provider === "brave") Object.assign(props, {
    country: Type.Optional(Type.String()), searchLang: Type.Optional(Type.String()), uiLang: Type.Optional(Type.String()), safesearch: Type.Optional(Type.String()), freshness: Type.Optional(Type.String()), maxUrls: Type.Optional(int("Maximum URLs", 1, MAX_NUM_RESULTS)),
  });
  if (provider === "firecrawl") Object.assign(props, {
    location: Type.Optional(Type.String()), country: Type.Optional(Type.String()), includeDomains: Type.Optional(Type.Array(Type.String())), excludeDomains: Type.Optional(Type.Array(Type.String())), categories: Type.Optional(Type.Array(Type.String())), tbs: Type.Optional(Type.String()), scrape: Type.Optional(Type.Boolean({ description: "Enable default markdown scrape-on-search" })), scrapeOptions: Type.Optional(Type.Object({}, { additionalProperties: true, description: "Firecrawl scrapeOptions for search." })),
  });
  return Type.Object(props, { additionalProperties: false });
}

export function buildFetchSchema(provider: FetchProviderName) {
  const props: Record<string, any> = {
    url: Type.Optional(Type.String({ description: "Single URL", maxLength: 2048 })),
    urls: Type.Optional(Type.Array(Type.String({ maxLength: 2048 }), { description: `Multiple URLs (max ${MAX_URL_COUNT})`, maxItems: MAX_URL_COUNT })),
    offset: Type.Optional(int("Character offset for cached/ranged reads", 0, MAX_OFFSET)),
    limit: Type.Optional(int("Maximum characters to return", 1, MAX_LIMIT)),
    refresh: Type.Optional(Type.Boolean({ description: "Refetch even if cached" })),
  };
  if (provider === "tinyfish") Object.assign(props, { format: Type.Optional(Type.Union([Type.Literal("markdown"), Type.Literal("html"), Type.Literal("json")])), links: Type.Optional(Type.Boolean()), imageLinks: Type.Optional(Type.Boolean()) });
  if (provider === "markdown_new") Object.assign(props, { method: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("ai"), Type.Literal("browser")])), retainImages: Type.Optional(Type.Boolean()) });
  if (provider === "firecrawl") Object.assign(props, {
    format: Type.Optional(Type.Union([Type.Literal("markdown"), Type.Literal("html"), Type.Literal("json")])),
    onlyMainContent: Type.Optional(Type.Boolean()), waitFor: Type.Optional(int("Milliseconds to wait", 0, 60_000)), mobile: Type.Optional(Type.Boolean()), location: Type.Optional(Type.String()), maxAge: Type.Optional(int("Maximum cached page age", 0)),
  });
  return Type.Object(props, { additionalProperties: false });
}

function buildSearchDescription(provider: SearchProviderName): string {
  return `Search the web with startup provider '${provider}'. Use query or queries; returns compact results grouped by query. Restart/reload pi after provider changes.`;
}

function buildFetchDescription(provider: FetchProviderName): string {
  return `Fetch URL content with startup provider '${provider}'. Results are cached by URL/options; use offset/limit to read long pages in chunks. Restart/reload pi after provider changes.`;
}

function normalizeQueries(params: Record<string, any>): string[] {
  const raw = Array.isArray(params.queries) ? params.queries : params.query ? [params.query] : [];
  const queries = [...new Set(raw.map((q) => String(q).trim()).filter(Boolean))];
  if (queries.length > MAX_QUERY_COUNT) throw new Error(`Too many queries: maximum is ${MAX_QUERY_COUNT}.`);
  return queries;
}

function normalizeUrls(params: Record<string, any>): string[] {
  return normalizeUrlInput({ url: params.url, urls: params.urls }, MAX_URL_COUNT);
}

export async function fetchWithCache(providerName: FetchProviderName, params: Record<string, any>, urls: string[], signal: AbortSignal | undefined, config: any) {
  const provider = createFetchProvider(config);
  const offset = parseInteger(params.offset, 0, "offset", 0, MAX_OFFSET);
  const defaultLimit = urls.length > 1 ? MULTI_FETCH_LIMIT : DEFAULT_FETCH_LIMIT;
  const limit = parseInteger(params.limit, defaultLimit, "limit", 1, MAX_LIMIT);
  const refresh = params.refresh === true;

  const pages = new Map<string, { page?: CachedPage; cached: boolean; refreshed: boolean; error?: string }>();
  const missing: string[] = [];
  for (const url of urls) {
    const cacheKey = buildCacheKey(providerName, url, params, config);
    const cached = fetchCache.get(cacheKey);
    if (cached && !refresh) pages.set(url, { page: cached, cached: true, refreshed: false });
    else missing.push(url);
  }

  if (missing.length > 0) {
    const fetched = await provider.fetch({ ...params, url: undefined, urls: missing }, signal);
    const mapped = mapFetchResults(missing, fetched);
    for (const requestedUrl of missing) {
      const item = mapped.get(requestedUrl);
      if (!item || item.error) {
        pages.set(requestedUrl, { error: item?.error ?? "No content returned.", cached: false, refreshed: refresh });
        continue;
      }
      const cacheKey = buildCacheKey(providerName, requestedUrl, params, config);
      const page = fetchCache.set(cacheKey, {
        provider: providerName,
        cacheKey,
        requestedUrl,
        url: item.url || requestedUrl,
        title: item.title,
        content: item.content ?? "",
        format: item.format ?? "markdown",
        metadata: item.metadata,
        fetchedAt: Date.now(),
      });
      pages.set(requestedUrl, { page, cached: false, refreshed: refresh });
    }
  }

  return { provider: providerName, results: urls.map((url) => {
    const entry = pages.get(url);
    if (!entry?.page) return { url, error: entry?.error ?? "No content returned." };
    return pageSlice(entry.page, offset, limit, entry.cached, entry.refreshed);
  }) };
}

function mapFetchResults(requested: string[], fetched: WebFetchResult): Map<string, WebFetchResult["results"][number]> {
  const out = new Map<string, WebFetchResult["results"][number]>();
  const remaining = [...(fetched.results ?? [])];
  for (const url of requested) {
    const index = remaining.findIndex((item) => urlsMatch(item.url, url));
    if (index >= 0) out.set(url, remaining.splice(index, 1)[0]);
  }
  requested.forEach((url, index) => { if (!out.has(url) && fetched.results?.[index]) out.set(url, fetched.results[index]); });
  return out;
}

export function pageSlice(page: CachedPage, offset: number, limit: number, cached: boolean, refreshed: boolean) {
  const total = page.content.length;
  const content = page.content.slice(offset, offset + limit);
  return { url: page.requestedUrl ?? page.url, fetchedUrl: page.url, title: page.title, content, format: page.format, cached, refreshed, cacheKey: page.cacheKey, range: { offset, limit, returned: content.length, total, truncated: offset > 0 || offset + content.length < total, hasPrevious: offset > 0, hasNext: offset + content.length < total } };
}

export function buildCacheKey(provider: FetchProviderName, url: string, params: Record<string, any>, config?: any): string {
  const canonical = canonicalWebUrl(url);
  const affecting: Record<string, unknown> = {};
  for (const key of Object.keys(params).sort()) {
    if (["url", "urls", "offset", "limit", "refresh"].includes(key)) continue;
    affecting[key] = params[key];
  }
  for (const [key, value] of Object.entries(fetchConfigDefaults(provider, config))) if (affecting[key] === undefined) affecting[key] = value;
  const scope = providerScope(provider, config);
  return `${provider}\0${scope}\0${JSON.stringify(affecting)}\0${canonical}`;
}

function parseInteger(value: unknown, defaultValue: number, name: string, min: number, max: number): number {
  if (value == null) return defaultValue;
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be a finite integer between ${min} and ${max}.`);
  return value;
}

function fetchConfigDefaults(provider: FetchProviderName, config?: any): Record<string, unknown> {
  if (provider === "markdown_new") return { method: config?.markdownNew?.method ?? "auto", retainImages: config?.markdownNew?.retainImages ?? false };
  if (provider === "firecrawl") return { onlyMainContent: true, format: "markdown" };
  return {};
}

function providerScope(provider: FetchProviderName, config?: any): string {
  const key = provider === "exa" || provider === "exa_mcp" ? config?.apiKeys?.exa : provider === "tinyfish" ? config?.apiKeys?.tinyfish : provider === "firecrawl" ? config?.apiKeys?.firecrawl : undefined;
  return key ? `key:${String(key).slice(0, 8)}` : "default";
}

function assertProviderUnchanged(tool: string, startup: string, runtime: string) {
  if (startup !== runtime) throw new Error(`${tool} was registered for provider '${startup}' but runtime config resolved '${runtime}'. Restart or reload pi after changing pi-web-kit provider config so tool schemas match the active provider.`);
}

function boundedDetails(value: any): unknown {
  if (value?.queries && Array.isArray(value.queries)) return { provider: value.provider, queries: value.queries.map((q: any) => ({ query: q.query, results: (q.results ?? []).map((r: any) => ({ title: r.title, url: r.url, siteName: r.siteName, position: r.position })) })) };
  if (value?.results && Array.isArray(value.results)) return { provider: value.provider, results: value.results.map((r: any) => ({ url: r.url, fetchedUrl: r.fetchedUrl, title: r.title, format: r.format, cached: r.cached, refreshed: r.refreshed, cacheKey: r.cacheKey, range: r.range, error: r.error })) };
  return value;
}
