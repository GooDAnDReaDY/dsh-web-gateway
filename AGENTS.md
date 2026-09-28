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
- Settings card seats: `plugins.item` + `plugins.row.config`. `settings.plugin.item` was retired before DSH 0.1.7-rc.2 and mounts nothing.
- Settings namespace is the **profile entry id** from `cordis.patch.yml` (`dsh-web-gateway`), not the package name.
- Card fields must be `.volatile()` in `Config`: DSH builds a namespace's form from the volatile fields only, and a schema with no volatile field yields no form. Read them back with `.get()`, or through the `plainVolatile` helper in `lib/index.js`.
- Card read path is `scope.getSnapshot()` + `scope.subscribe()`. `ConfigForm` has no `get()`/`watch()`; the per-field `scope.set(field, value)` write path is correct.
- Host picks up settings writes via `ctx.on('loader/volatile-update', ...)`. `settings.register` exists in neither DSH 0.1.7-rc.2 nor 0.2.0.
- Peer ranges must accept both DSH lines: `^0.1.7-rc.2 || ^0.2.0-rc.1`. `@deepseek-ai/schemastery` needs `^3.18.4`, the first line shipping `.volatile()`.
