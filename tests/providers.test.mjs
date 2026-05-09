import test from "node:test";
import assert from "node:assert/strict";
import { ExaMcpProvider } from "../src/providers/exa-mcp.ts";
import { ExaProvider } from "../src/providers/exa.ts";
import { TinyFishProvider } from "../src/providers/tinyfish.ts";
import { BraveProvider } from "../src/providers/brave.ts";
import { FirecrawlProvider } from "../src/providers/firecrawl.ts";
import { resolveConfig } from "../src/config.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cfg = (apiKeys = {}) => ({ provider_search: "exa_mcp", provider_fetch: "exa_mcp", apiKeys, markdownNew: { method: "auto", retainImages: false } });

test("Exa MCP stores mcp-session-id header and sends it on tools/call", async () => {
  const calls = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    calls.push(init);
    const body = JSON.parse(init.body);
    if (body.method === "initialize") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "session-123" } });
    }
    if (body.method === "notifications/initialized") return new Response("", { status: 202 });
    if (body.method === "tools/call") {
      assert.equal(init.headers["mcp-session-id"], "session-123");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { results: [{ title: "T", url: "https://example.com", snippet: "S" }] } } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected ${body.method}`);
  };
  try {
    const provider = new ExaMcpProvider(cfg());
    const result = await provider.search({ query: "q" });
    assert.equal(result.results[0].url, "https://example.com");
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("keyed providers fail clearly when keys are missing", () => {
  assert.throws(() => new ExaProvider(cfg()), /EXA_API_KEY/);
  assert.throws(() => new TinyFishProvider(cfg()), /TINYFISH_API_KEY/);
  assert.throws(() => new BraveProvider(cfg()), /BRAVE_SEARCH_API_KEY/);
  assert.throws(() => new FirecrawlProvider(cfg()), /FIRECRAWL_API_KEY/);
});

test("config-file API keys override environment for all keyed providers", () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-kit-"));
  writeFileSync(join(cwd, ".pi-web-kit.json"), JSON.stringify({ apiKeys: { exa: "file-exa", tinyfish: "file-tiny", brave: "file-brave", firecrawl: "file-fire" } }));
  const cfg = resolveConfig({}, cwd, {
    EXA_API_KEY: "env-exa",
    TINYFISH_API_KEY: "env-tiny",
    BRAVE_SEARCH_API_KEY: "env-brave",
    FIRECRAWL_API_KEY: "env-fire",
  });
  assert.equal(cfg.apiKeys.exa, "file-exa");
  assert.equal(cfg.apiKeys.tinyfish, "file-tiny");
  assert.equal(cfg.apiKeys.brave, "file-brave");
  assert.equal(cfg.apiKeys.firecrawl, "file-fire");
});
