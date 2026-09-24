# Findings — Phase D (Release 1)

## Architecture Notes
- `runProviderChain` in `lib/chain.js` takes attempts array `{ name, run }`.
- Providers are wrapped in `withCap` in `lib/index.js`.
- Adding a circuit breaker can wrap runner functions similarly (`withCircuitBreaker`).
- Brave Search Web API: endpoint `https://api.search.brave.com/res/v1/web/search`, header `X-Subscription-Token`.
- DuckDuckGo Lite: endpoint `https://lite.duckduckgo.com/lite/`, parses HTML result links.
