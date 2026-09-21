# Changelog

## Unreleased

### Phase A (transparency & control)
- Tool responses include `provider`, `skipped[]`, and `cached`
- Configurable `searchProviderOrder` / `extractProviderOrder`
- Settings card health check for credential presence and local endpoint ping

### Phase B (query quality & cost)
- Search domain include/exclude + freshness (settings + tool params)
- Disk-backed profile cache (layered with memory)
- Per-provider daily caps (UTC) with card usage

## 0.1.2

First public release of `@goodandready/dsh-web-gateway`.

- Public package identity under `@goodandready/dsh-web-gateway`
- Tools: `web_gateway_search`, `web_gateway_extract` with provider fallback chains
- SSRF-safe extract URL policy (public IPs only; optional `allowInternalUrls`)
- Settings card for limits, timeouts, cache, SearXNG/Crawl4AI URLs, credential names
- English and Chinese UI locales; README in English, Chinese, and Russian
