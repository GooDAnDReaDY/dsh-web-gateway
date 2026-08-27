# dsh-web-gateway

Web search & extraction tools for DeepSeek Harness with a resilient fallback chain (Hermes-style).

## Tools

- **`web_gateway_search(query, limit?, search_depth?)`** — search the web. Chain: `tavily → firecrawl → exa → local searxng`. A provider is skipped on error / empty result / 429 / 5xx. Results are cached in memory (TTL, default 10 min). Prefer over the built-in `web_search` when it hits rate limits / captchas.
- **`web_gateway_extract(url)`** — fetch a URL and return readable markdown. Chain: `firecrawl scrape → tavily extract → crawl4ai (optional)`. Prefer over the built-in `web_extract` when it fails.

> Tool names deliberately differ from the built-in `web_search` / `web_extract` (dsh-tool-web) to avoid duplicate-registration collisions.

## Keys

Resolved via the DSH credentials service, falling back to the process environment.
Add to `$DSH_HOME/.credentials.yaml` (or Settings → Credentials) or the `dsh-web` service env:

| Ref | Provider |
|---|---|
| `TAVILY_API_KEY` | tavily (search + extract) |
| `FIRECRAWL_API_KEY` | firecrawl (search + scrape) |
| `EXA_API_KEY` | exa (search) |
| `CRAWL4AI_TOKEN` | crawl4ai (extract, only if `crawl4aiUrl` is set) |

## Config (override in `$DSH_HOME/settings.yaml` under `dsh-web-gateway:` or the profile's `cordis.patch.yml`)

- `defaultLimit` (5), `maxLimit` (20), `timeoutMs` (30000), `cacheTtlMs` (600000)
- `searxngUrl` — optional local SearXNG base URL, e.g. `http://127.0.0.1:8888` (empty = disabled)
- `crawl4aiUrl` — optional crawl4ai base URL, e.g. `http://127.0.0.1:11235` (empty = disabled)
- per-provider env refs: `tavilyApiKeyEnv`, `firecrawlApiKeyEnv`, `exaApiKeyEnv`, `crawl4aiTokenEnv`

## Install

```bash
dsh plugin --profile web add @goodandready-private/dsh-web-gateway
# verify + restart: see dsh-plugin-authoring skill (node --check, dump-config, restart dsh-web, NRestarts=0)
```

## Notes

- Output is text-only (no image blocks) — safe for text-only models.
- SearXNG fallback only works if the instance is reachable from the host; by default it is disabled until `searxngUrl` is set.
- crawl4ai requires its API token and is disabled until `crawl4aiUrl` is set.
