# Changelog

## 0.1.5

Release 1 (Phase D) — Core search resilience, reliability and token efficiency.

### Added
- **Brave Search API** provider (`brave`) with `BRAVE_API_KEY` credential support (#23)
- **DuckDuckGo** keyless search fallback (`duckduckgo`) without requiring API keys (#23)
- **Circuit Breaker** to temporarily pause providers in cooldown after repeated failures or rate limits (#25)
- **Token-efficient content pruning** (`compactExtract`) to strip boilerplate cookie notices, navigation lists and social links (#26)
- **Category-aware search** (`category: general | news | code | academic`) for `web_gateway_search` and `web_gateway_research` (#27)
- **Structured document handling** in `web_gateway_extract` for `.csv`, `.json`, `.txt`, and PDF document links (#24)
- Settings card controls for Brave / DuckDuckGo daily caps, circuit breaker threshold, and compact extract (#23, #25, #26)

## 0.1.4

### Fixed
- The settings card no longer waits for the removed `settingsScope` service. It uses `configForms` on current DeepSeek Harness (#21).

## 0.1.3

Public feature release after phases A+B+C.

### Transparency & control
- Tool responses include `provider`, `skipped[]`, and `cached`
- Configurable `searchProviderOrder` / `extractProviderOrder`
- Settings card health for credential presence and local endpoints

### Query quality & cost
- Search domain include/exclude + freshness (settings + tool params)
- Disk-backed profile cache (layered with memory)
- Per-provider daily caps (UTC) with card usage

### Agent power
- Tool `web_gateway_research` (search → top-N extract → brief)
- Keyless extract fallbacks: Jina Reader + HTML readability

## 0.1.2

First public release of `@goodandready/dsh-web-gateway`.

- Public package identity under `@goodandready/dsh-web-gateway`
- Tools: `web_gateway_search`, `web_gateway_extract` with provider fallback chains
- SSRF-safe extract URL policy (public IPs only; optional `allowInternalUrls`)
- Settings card for limits, timeouts, cache, SearXNG/Crawl4AI URLs, credential names
- English and Chinese UI locales; README in English, Chinese, and Russian
