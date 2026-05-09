# pi-web-kit

Context-efficient web tools for pi: `web_search` and `web_fetch`.

## Install

```bash
pi install /path/to/pi-web-kit
pi install git:github.com/USER/pi-web-kit
pi install npm:pi-web-kit
```

This is an npm-compatible TypeScript pi package. Bun is not required.

## Providers

Defaults: `provider_search = "exa_mcp"`, `provider_fetch = "exa_mcp"`.

| Provider | Search | Fetch | Key |
|---|---:|---:|---|
| `exa_mcp` | yes | yes | optional `EXA_API_KEY` |
| `exa` | yes | yes | `EXA_API_KEY` |
| `tinyfish` | yes | yes | `TINYFISH_API_KEY` |
| `brave` | yes | no | `BRAVE_SEARCH_API_KEY` |
| `firecrawl` | yes | yes | `FIRECRAWL_API_KEY` |
| `markdown_new` | no | yes | none |

Tool schemas are tailored to the configured providers at startup/reload, so only supported provider-specific fields are exposed.

## Configuration

Resolution order: defaults < environment variables < config file < CLI flags.

```bash
PI_WEB_KIT_PROVIDER_SEARCH=exa_mcp|exa|tinyfish|brave|firecrawl
PI_WEB_KIT_PROVIDER_FETCH=exa_mcp|exa|tinyfish|markdown_new|firecrawl
EXA_API_KEY=...
TINYFISH_API_KEY=...
BRAVE_SEARCH_API_KEY=...
FIRECRAWL_API_KEY=...
```

Config files:

1. `.pi-web-kit.json`
2. `~/.pi/agent/pi-web-kit.json`

```json
{
  "provider_search": "firecrawl",
  "provider_fetch": "markdown_new",
  "apiKeys": {
    "firecrawl": "..."
  },
  "markdownNew": {
    "method": "auto",
    "retainImages": false
  }
}
```

Do not commit config files containing secrets.

CLI overrides:

```bash
pi -e . --web-provider-search firecrawl --web-provider-fetch markdown_new --print "Search and fetch docs"
```

## Tools

- `web_search`: accepts `query` or `queries`, plus active-provider fields.
- `web_fetch`: accepts `url` or `urls`; caches by URL and supports `offset`, `limit`, and `refresh` for long pages.

## Development

```bash
npm install
npm run typecheck
npm test
```
