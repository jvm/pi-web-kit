# Changelog

All notable changes to this project will be documented in this file.

This project follows the spirit of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versioning for releases.

## [Unreleased]

## [0.1.1] - 2026-05-09

### Fixed

- Show the Pi extension as `pi-web-kit` instead of `pi-web-kit:pi-web-kit` in the startup extensions list.

## [0.1.0] - 2026-05-09

### Added

- Initial `pi-web-kit` package with `web_search` and `web_fetch` Pi tools.
- Search providers: `exa_mcp`, `exa`, `tinyfish`, `brave`, and `firecrawl`.
- Fetch providers: `exa_mcp`, `exa`, `tinyfish`, `markdown_new`, and `firecrawl`.
- Provider-specific tool schemas, startup-provider mismatch guidance, and CLI provider override flags.
- In-memory fetch cache with TTL, LRU eviction, max entry count, max byte count, and fetch-affecting cache keys.
- URL validation and normalization for HTTP(S)-only URLs, credential rejection, fragment stripping, duplicate removal, and URL count/length caps.
- Request limits, bounded provider concurrency, fetch timeouts, and robust provider result mapping for canonicalized or redirected URLs.
- Tests for config precedence, provider behavior, cache safety, URL validation, concurrency, timeouts, and tool behavior.
- GitHub-ready project docs, issue templates, CI, and npm provenance publishing workflow.
