# @goodandready/dsh-web-gateway

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的弹性 **网页搜索** 与 **页面提取** 工具。

当内置 `web_search` / `web_fetch` 遇到限流、验证码或空结果时，本插件提供另一套独立工具名的回退链（不会与核心工具注册冲突）。

## 工具

| 工具 | 作用 |
|---|---|
| `web_gateway_search` | 网页搜索。链路：**Tavily → Firecrawl → Exa → 本地 SearXNG** |
| `web_gateway_extract` | 将 URL 提取为 Markdown。链路：**Firecrawl scrape → Tavily extract → 可选 Crawl4AI** |

缺少密钥、空结果、HTTP 429/5xx 或网络错误时会跳过该提供商。结果可按 TTL 缓存在内存中。

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
