# 📦 @goodandready/dsh-web-gateway

<div align="center">

<h3>Отказоустойчивый веб-поиск и безопасное извлечение страниц (SSRF-Safe) для DeepSeek Harness</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/@goodandready/dsh-web-gateway"><img src="https://img.shields.io/npm/v/@goodandready/dsh-web-gateway.svg?style=for-the-badge&color=6366f1&labelColor=1e1b4b" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/GooDAnDReaDY/dsh-web-gateway.svg?style=for-the-badge&color=10b981&labelColor=064e3b" alt="license"></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/DSH-Plugin-8b5cf6.svg?style=for-the-badge&labelColor=2e1065" alt="DSH Plugin"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node-20%2B-f59e0b.svg?style=for-the-badge&labelColor=451a03" alt="Node version"></a>
</p>

<p align="center">
  <a href="https://goodandready.app/"><img src="https://img.shields.io/badge/Все_проекты_автора-goodandready.app-ff4500.svg?style=for-the-badge&logo=rocket&logoColor=white&labelColor=1a1a2e" alt="Все проекты автора"></a>
</p>

<p align="center">
  <a href="README.md"><b>🇬🇧 English</b></a> •
  <a href="README.zh.md"><b>🇨🇳 中文说明</b></a> •
  <a href="README.ru.md"><b>🇷🇺 Русский</b></a>
</p>

<table align="center">
  <tr>
    <td align="center">
      ⭐ <strong>Если вам нравится этот плагин, поставьте ему Star на GitHub</strong> — это покажет мне, что плагин полезен, и добавит мотивации продолжать его развитие.
      <br><br>
      🐛 <strong>Если вы нашли ошибку или хотите предложить новую функцию</strong>, откройте issue на GitHub на любом удобном языке — я регулярно просматриваю предложения и реализую полезные идеи в будущих версиях плагина.
    </td>
  </tr>
</table>

</div>

---

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
