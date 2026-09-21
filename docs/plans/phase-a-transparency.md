# Phase A — Transparency & control

Owner-approved roadmap block A for `@goodandready/dsh-web-gateway`.

## Issues
- #7 Provider skip/success reporting
- #8 Configurable provider order
- #9 Settings card health

## Design decisions
- Tool responses always include `provider`, `skipped[]`, `cached`, `tookMs`.
- Provider order is a comma-separated settings string (not free-form plugins).
- Health never returns secret values; credentials are `present`/`missing` only.
- Health endpoint: `GET /api/dsh-web-gateway/health`.

## Out of scope (later phases)
- Domain filters / freshness (B)
- Disk cache / daily caps (B)
- `web_gateway_research` / keyless extract (C)
