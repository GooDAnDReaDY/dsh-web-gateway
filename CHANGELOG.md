# Changelog

## 0.2.0

### Added
- **Parallel Search Strategies** (#28): Added `searchStrategy` (`fallback` sequential default, `race` fastest-wins with `AbortController` cancellation of slower competitors, and `aggregate` parallel multi-provider query with normalized URL deduplication) plus `parallelMaxConcurrency` configuration and `strategy` tool parameter on `web_gateway_search`.
- **Normalized Query Keys & Semantic Caching** (#29): Added `normalizeSearchQuery` in `lib/filters.js` to canonicalize search cache keys across casing, punctuation, and word-order permutations while preserving quoted phrases (`"..."`), `-negations`, and `site:` operators.
- **Visual Page Snapshots** (#30): Added `take_screenshot: boolean` parameter to `web_gateway_extract` supported by Firecrawl and Crawl4AI providers, persisting bounded PNG/JPEG/WebP snapshots under `<profileDir>/data/dsh-web-gateway/screenshots`.
- **Latency Telemetry & Cost Estimation** (#31): Added rolling latency window (p50/p95 ms) and per-provider USD cost estimation in `lib/telemetry.js`, exposed via `GET /api/dsh-web-gateway/health` (with `POST /api/dsh-web-gateway/health` reset) and displayed in the Web Gateway settings card.
- **Configurable Outbound Egress Proxy** (#32): Added `egressProxyUrl` setting validated via `parseProxyUrl` and wired into `getSafeDispatcher` for SearXNG, DuckDuckGo, Crawl4AI, and Readability while enforcing pre-proxy SSRF target checks (`assertExtractUrlAllowed`).

## 0.1.8

### Security & Hardening
- **SSRF Policy Hardening** (#44, #49, #53): Connect-time DNS validation and safe dispatcher hook to prevent TOCTOU SSRF rebinding; extended IPv6 SSRF validation to block local-use NAT64 (`64:ff9b:1::/48`, RFC 8215) and Teredo (`2001::/32`, RFC 4380).
- **Same-Origin Redirect Enforcement** (#42): Enforced `assertSameOriginRedirect` on public readability extracts to prevent cross-origin redirect escapes.
- **Bounded Response Bodies** (#43): Added streaming length limits (`MAX_BODY_BYTES = 2MB`) to protect against memory exhaustion on large upstream responses.
- **Endpoint Protection** (#52): Restricted `/api/dsh-web-gateway/health` and GET `/api/dsh-web-gateway/update` endpoints to loopback requests.

### Fixed
- **Settings Deserialization** (#41, #47): Fixed `readConfig` to properly unwrap boxed `Volatile` values before cloning, preventing silent fallback to schema defaults.
- **Slot Contract Compliance** (#48): Aligned slot registrations with DSH core contracts (`plugins.row.config` strictly keyed `@goodandready/dsh-web-gateway#dsh-web-gateway`, `plugins.item` registered with `id` and `label`).
- **Locale Lifecycles** (#50): Wrapped UI locale registrations in `ctx.effect` to prevent duplicate registrations and ensure clean hot-reloads.
- **Design System Tokens** (#51): Replaced invalid CSS aliases with official DSH theme tokens (`--dsw-alias-state-error-primary`, `--dsw-alias-state-warn-primary`).
- **Dynamic Tool Timeouts** (#45): Made tool `timeoutMs` dynamic getters so live configuration updates take immediate effect.
- **Daily Caps Concurrency** (#46): Added in-memory state synchronization for daily-caps counters to avoid race conditions.

## 0.1.7

### Fixed
- **Settings card never mounted** (#38): the card registered only on `settings.plugin.item`, retired before DSH 0.1.7-rc.2, so the plugin had no configuration UI on any current release. It now registers on `plugins.item` and `plugins.row.config`.
- **Namespace never served** (#37): `Config` declared no `.volatile()` field, and DSH builds a namespace's settings form from the volatile fields of its profile entry schema — a schema with none yields no form at all. Card-editable fields are now `.volatile()` and unwrapped to plain values on read, leaving every existing use site unchanged.
- **Settings writes never reached the host** (#37): the host called `settings.register`, which exists in neither 0.1.7-rc.2 nor 0.2.0, so the optional call silently yielded `undefined` and the plugin ran on boot defaults for the process lifetime. The host now re-reads its config on `loader/volatile-update`, which both releases emit.
- **Card read path** (#37): `ConfigForm` exposes `getSnapshot()` and a no-argument `subscribe()` in both releases; the card used `get()`/`watch()`, which exist in neither, so it always fell through to "unavailable". The per-field `set()` write path was already correct.

### Changed
- **Peer ranges** (#58): `@deepseek-ai/dsh-tools`, `dsh-credentials`, `dsh-host-webserver` and `dsh-settings` now accept both the 0.1.7-rc.2 and 0.2.0-rc.1 package lines (`^0.1.7-rc.2 || ^0.2.0-rc.1`).
- **`@deepseek-ai/schemastery` peer** raised to `^3.18.4`, the first line that ships `.volatile()`. 3.18.1–3.18.3 parse `.volatile()` as absent, which would break the form silently.

## 0.1.6

Security hardening and identity consistency release.

### Security
- **IPv6 SSRF protection**: fixed `isPublicIpv6` to parse IPv6 addresses into 8 words and validate IPv4-mapped addresses in hex (`::ffff:7f00:1`, `::ffff:a9fe:a9fe`) and dot-decimal forms through `isPublicIpv4`. Unspecified (`::`), multicast (`ff00::/8`), link-local, ULA, and documentation ranges are rejected (#19).
- **SSRF redirect validation**: `readabilityExtract` now enforces manual redirect handling, validating each intermediate target URL against public IP and scheme policies before following, preventing SSRF redirects to loopback/private hosts (#20).

### Fixed
- **Host export identity**: aligned `export const name` in `lib/index.js` with `@goodandready/dsh-web-gateway` across package, patch, and browser loader (#34).

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
