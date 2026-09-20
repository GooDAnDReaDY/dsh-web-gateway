# @goodandready/dsh-web-gateway

Устойчивые инструменты **веб-поиска** и **извлечения страниц** для [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Когда встроенные `web_search` / `web_fetch` упираются в лимиты, капчу или пустой ответ, этот плагин даёт модели отдельную запасную цепочку с другими именами инструментов (без конфликта регистрации).

## Инструменты

| Инструмент | Назначение |
|---|---|
| `web_gateway_search` | Поиск. Цепочка: **Tavily → Firecrawl → Exa → локальный SearXNG** |
| `web_gateway_extract` | Извлечение URL в Markdown. Цепочка: **Firecrawl scrape → Tavily extract → опционально Crawl4AI** |

Провайдер пропускается при отсутствии ключа, пустом ответе, HTTP 429/5xx или сетевой ошибке. Результаты кэшируются в памяти (настраиваемый TTL).

URL для extract проверяются: только **http/https**, без credentials в ссылке, hostname должен резолвиться в **публичный** IP (loopback / RFC1918 / link-local / metadata по умолчанию запрещены). `allowInternalUrls` включайте только осознанно.

## Установка

```bash
dsh plugin --profile web add @goodandready/dsh-web-gateway
```

После установки перезапустите web-профиль.

## Учётные данные

Ключи храните в **Настройки → Credentials** (или `$DSH_HOME/.credentials.yaml`). В карточке плагина — только **имена** credentials, не сами секреты.

## Связь со штатным веб-поиском DSH

В ядре уже есть `web_search` и `web_fetch` (`@deepseek-ai/dsh-tool-web`). Этот плагин их **не заменяет**, а добавляет `web_gateway_*` как запасной путь.

## Лицензия

MIT © [GooDAnDReaDY](https://github.com/GooDAnDReaDY)
