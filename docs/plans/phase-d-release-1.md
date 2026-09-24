# Phase D — Release 1 (Core Agent Enhancements)

## Issues
- #23 H: Brave Search API provider and keyless DuckDuckGo search fallback
- #24 H: Support PDF, DOCX and tabular document extraction in web_gateway_extract
- #25 M: Circuit breaker for failing or rate-limited providers
- #26 M: Content cleaning and token-efficient pruning in web_gateway_extract
- #27 M: Category-aware search modes (news, code, academic, general)

## Goals
1. Resilient search: Add Brave Search API and DuckDuckGo keyless search.
2. Document support: Enable extraction from PDF/DOCX links without crashes.
3. Reliability: Add Circuit Breaker to prevent long timeouts on failing providers.
4. Token efficiency: Add compact mode / content pruning for extracted pages.
5. Search accuracy: Support category filtering (news, code, academic, general).

## Strategy
Implement issue by issue with test-driven verification, clean conventional commits, and full doc updates.
