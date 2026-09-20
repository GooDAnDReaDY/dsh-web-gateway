# @goodandready/dsh-web-gateway

<p align="center">
  <a href="https://goodandready.app/"><img src="https://img.shields.io/badge/🌐_DSH_Hub-goodandready.app-ff4500.svg?style=for-the-badge&labelColor=1a1a2e" alt="GoodAndReady Showcase"></a>
</p>


Resilient **web search** and **page extract** tools for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

When the built-in `web_search` / `web_fetch` tools hit rate limits, captchas, or empty results, this plugin gives the model a separate fallback chain with different tool names (no registration collisions).

## Tools

| Tool | Purpose |
|---|---|
| `web_gateway_search` | Search the web. Chain: **Tavily → Firecrawl → Exa → local SearXNG** |
| `web_gateway_extract` | Fetch a URL as markdown. Chain: **Firecrawl scrape → Tavily extract → optional Crawl4AI** |

A provider is skipped on missing key, empty result, HTTP 429/5xx, or network error. Results are cached in memory (configurable TTL).

Extract URLs are validated: **http/https only**, no embedded credentials, and hostnames must resolve to **public** IPs (loopback / RFC1918 / link-local / metadata blocked). Set `allowInternalUrls` only if you intentionally need internal targets.

## Install

```bash
dsh plugin --profile web add @goodandready/dsh-web-gateway
```

Restart the web profile after install.

## Credentials

Add keys under **Settings → Credentials** (or `$DSH_HOME/.credentials.yaml`). The settings card stores only **credential names**, never secret values:

| Default name | Used by |
|---|---|
| `TAVILY_API_KEY` | search + extract |
| `FIRECRAWL_API_KEY` | search + scrape |
| `EXA_API_KEY` | search |
| `CRAWL4AI_TOKEN` | extract (only if `crawl4aiUrl` is set) |

## Settings

Configure in **Settings → Plugins → Web Gateway**:

| Setting | Default | Meaning |
|---|---|---|
| `defaultLimit` | `5` | Default search result count |
| `maxLimit` | `20` | Hard search cap |
| `timeoutMs` | `30000` | Per-provider timeout |
| `cacheTtlMs` | `600000` | In-memory cache TTL (`0` disables) |
| `searxngUrl` | empty | Local SearXNG base URL; empty disables |
| `crawl4aiUrl` | empty | Crawl4AI base URL; empty disables |
| `allowInternalUrls` | `false` | Allow private/loopback extract targets |

## How it relates to core DSH web tools

DeepSeek Harness already ships `web_search` and `web_fetch` via `@deepseek-ai/dsh-tool-web`. This plugin does **not** replace them. It registers `web_gateway_*` tools so the model can fall back when the built-in path fails.

## Development

```bash
npm test
npm run check
```

Tests run offline with mocked `fetch` (no live network).

## Visual verification

Plugins settings card for Web Gateway — Dark and Light themes side by side:

![dsh-web-gateway v0.1.2 visual verification](media/visual-verification.png)

## License

MIT © [GooDAnDReaDY](https://github.com/GooDAnDReaDY)
