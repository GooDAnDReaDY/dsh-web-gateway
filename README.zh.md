# 📦 @goodandready/dsh-web-gateway

<div align="center">

<h3>面向 DeepSeek Harness 的高可用网页搜索与 SSRF 安全页面提取回退链套件</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/@goodandready/dsh-web-gateway"><img src="https://img.shields.io/npm/v/@goodandready/dsh-web-gateway.svg?style=for-the-badge&color=6366f1&labelColor=1e1b4b" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/GooDAnDReaDY/dsh-web-gateway.svg?style=for-the-badge&color=10b981&labelColor=064e3b" alt="license"></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/DSH-Plugin-8b5cf6.svg?style=for-the-badge&labelColor=2e1065" alt="DSH Plugin"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node-20%2B-f59e0b.svg?style=for-the-badge&labelColor=451a03" alt="Node version"></a>
</p>

<p align="center">
  <a href="https://goodandready.app/"><img src="https://img.shields.io/badge/作者全部项目-goodandready.app-ff4500.svg?style=for-the-badge&logo=rocket&logoColor=white&labelColor=1a1a2e" alt="作者全部项目"></a>
</p>

<p align="center">
  <a href="README.md"><b>🇬🇧 English</b></a> •
  <a href="README.zh.md"><b>🇨🇳 中文说明</b></a> •
  <a href="README.ru.md"><b>🇷🇺 Русский</b></a>
</p>

<table align="center">
  <tr>
    <td align="center">
      ⭐ <strong>如果您喜欢这个插件，请在 GitHub 上为它点亮 Star</strong> — 这能让我知道插件对您有用，并鼓励我继续开发和维护它。
      <br><br>
      🐛 <strong>如果您发现 Bug 或希望增加功能</strong>，请使用任意语言在 GitHub 上提交 Issue — 我会评估您的建议，并在后续版本中实现有价值的改进。
    </td>
  </tr>
</table>

</div>

---

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的弹性 **网页搜索** 与 **页面提取** 工具。

当内置 `web_search` / `web_fetch` 遇到限流、验证码或空结果时，本插件提供另一套独立工具名的回退链（不会与核心工具注册冲突）。

## 工具

| 工具 | 作用 |
|---|---|
| `web_gateway_search` | 网页搜索。链路：**Tavily → Brave → Firecrawl → Exa → 本地 SearXNG → DuckDuckGo** |
| `web_gateway_extract` | 将 URL 提取为 Markdown。链路：**Firecrawl → Tavily → Crawl4AI → Jina → readability** |
| `web_gateway_research` | 搜索并提取多来源网页为精简 Markdown 摘要 |

缺少密钥、空结果、HTTP 429/5xx 或网络错误时会跳过该提供商。内置**熔断器 (Circuit Breaker)** 会在多次连续失败后自动暂时隔离该提供商。结果可按 TTL 缓存在内存中。

提取 URL 会校验：仅 **http/https**，禁止 URL 内嵌凭据，主机名必须解析为 **公网** IP（回环 / RFC1918 / 链路本地 / 元数据地址默认拦截）。仅在确实需要时才打开 `allowInternalUrls`。

## 安装

```bash
dsh plugin --profile web add @goodandready/dsh-web-gateway
```

安装后请重启 web 配置文件。

## 凭证

在 **设置 → 凭证**（或 `$DSH_HOME/.credentials.yaml`）中保存密钥。设置卡片只保存 **凭证名称**，不保存密钥本身。

## 与核心网页工具的关系

Harness 已通过 `@deepseek-ai/dsh-tool-web` 提供 `web_search` / `web_fetch`。本插件 **不替换** 它们，只额外提供 `web_gateway_*` 作为回退。

## 许可证

MIT © [GooDAnDReaDY](https://github.com/GooDAnDReaDY)
