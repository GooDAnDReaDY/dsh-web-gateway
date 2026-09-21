# DESIGN.md — dsh-web-gateway

## Product / Purpose
- Purpose: resilient fallback web search and page extract for DSH agents when built-in web tools fail.
- Audience: DSH operators and agent users who need multi-provider search.
- Status: public plugin candidate (migrated from private package).

## User Surfaces
- Web/UI: settings card via `settings.plugin.item` (collapsed by default).
- DSH tools: `web_gateway_search`, `web_gateway_extract`.
- API: `/api/dsh-web-gateway/update` (one-click updater).
- CLI: none.
- Docs: README.md / README.zh.md / README.ru.md.

## Visual Direction
- Native DSH settings card tokens (`--dsw-alias-*`), 12px radius, chevron from primitives when available.
- Do not invent a separate navigation section.

## Components And States
- Loading / unavailable / ready settings snapshot.
- Save success / field-level save errors.
- Updater: check, up-to-date, available, failure, post-update restart hint.
- Dangerous toggle: `allowInternalUrls` with warning styling when enabled.

## User Flows
1. Install plugin → open Settings → Plugins → Web Gateway → set SearXNG/Crawl4AI URLs and credential names → Save.
2. Agent calls `web_gateway_search` / `web_gateway_extract` when built-in web tools are insufficient.
3. Optional one-click update from the card.

## Do / Don't
- Do keep tool names distinct from `web_search` / `web_fetch`.
- Do block private extract targets by default.
- Don't store API key values in settings.
- Don't register a top-level settings.section.

## Locked Design Decisions
- 2026-09-20 — Public package `@goodandready/dsh-web-gateway`; reason: public plugin policy; revisit only for identity migration task.
- 2026-09-20 — SSRF-safe extract by default; reason: Gitea #1; revisit only with explicit allowInternalUrls.

## Roadmap (approved 2026-09-21)
- Phase A (#7–#9): skip reporting, provider order, health card — in progress.
- Phase B (#10–#12): domain filters/freshness, disk cache, daily caps.
- Phase C (#13–#14): `web_gateway_research`, keyless extract fallback.
- Packaging: three release blocks A→B→C (not one monolith).

## Locked Design Decisions
- 2026-09-21 — Tool responses expose `skipped` + `cached`; reason: operator/agent transparency; revisit only if output size becomes a problem.
- 2026-09-21 — Provider order via comma-separated settings strings; reason: simple native card fields; revisit if DSH gains ordered-list settings widgets.
- 2026-09-21 — Health shows credential presence only (never values); reason: secret hygiene; revisit never for raw keys.
