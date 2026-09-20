# AGENTS.md — dsh-web-gateway

## Purpose
DSH plugin: `web_gateway_search` + `web_gateway_extract` with multi-provider fallback.

## Paths
- DEV: `/mnt/external/Project/DEV/dhsplugins/dsh-web-gateway`
- Work in `.worktrees/<branch>` only
- Gitea: `goodandready/dsh-web-gateway`

## Commands
- `npm test` — offline unit tests
- `npm run check` — syntax check

## Constraints (MUST NOT)
- Do not register tools named `web_search` or `web_fetch`
- Do not hardcode secrets, internal IPs, or host paths in published files
- Do not enable `allowInternalUrls` by default
- Do not fix unrelated installed plugins from this repo

## Conventions
- English + Chinese locale in client; Russian UI via `dsh-russian-lang`
- Settings card: `settings.plugin.item`, key = `dsh-web-gateway`
