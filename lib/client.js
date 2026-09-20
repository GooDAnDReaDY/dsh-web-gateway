window.__ModuleLoader__.load({
  id: '@goodandready/dsh-web-gateway',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const NS = 'dsh-web-gateway'
    const PKG = '@goodandready/dsh-web-gateway'

    let ChevronIcon = null
    try {
      const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
      ChevronIcon = primitives && primitives.IconChevronDownOutline14
    } catch (_) {
      ChevronIcon = null
    }

    const en = {
      title: 'Web Gateway',
      subtitle: 'Resilient web search & extract fallback chain',
      header_desc: 'Fallback web search (Tavily → Firecrawl → Exa → SearXNG) and page extract when built-in web_search / web_fetch hit limits.',
      'settings.loading': 'Loading Web Gateway settings…',
      'settings.unavailable': 'Settings scope unavailable (host namespace is not ready).',
      'settings.retry': 'Retry',
      saved: 'Settings saved',
      save: 'Save',
      saving: 'Saving…',
      defaultLimit: 'Default result limit',
      defaultLimitDesc: 'Default max results for web_gateway_search.',
      maxLimit: 'Hard result cap',
      maxLimitDesc: 'Maximum results one search call may return.',
      timeoutMs: 'Provider timeout (ms)',
      timeoutMsDesc: 'Per-provider HTTP timeout in milliseconds.',
      cacheTtlMs: 'Cache TTL (ms)',
      cacheTtlMsDesc: 'In-memory result cache lifetime. 0 disables caching.',
      searxngUrl: 'SearXNG base URL',
      searxngUrlDesc: 'Optional local SearXNG (e.g. http://127.0.0.1:8080). Empty disables this fallback.',
      crawl4aiUrl: 'Crawl4AI base URL',
      crawl4aiUrlDesc: 'Optional crawl4ai extract fallback. Empty disables it.',
      tavilyApiKeyEnv: 'Tavily credential name',
      firecrawlApiKeyEnv: 'Firecrawl credential name',
      exaApiKeyEnv: 'Exa credential name',
      crawl4aiTokenEnv: 'Crawl4AI credential name',
      keysDesc: 'Store secret values in Settings → Credentials under these names. Do not paste API keys here.',
      allowInternalUrls: 'Allow internal extract URLs',
      allowInternalUrlsDesc: 'Dangerous: permits extract targets that resolve to loopback/private addresses. Keep off unless you intentionally need it.',
      updater_title: 'Plugin version',
      updater_current: 'Current',
      updater_latest: 'Latest',
      updater_checking: 'Checking…',
      updater_check: 'Check for updates',
      updater_updating: 'Updating…',
      updater_update_now: 'Update to {version}',
      updater_up_to_date: 'Up to date',
      updater_failed: 'Update check failed',
      updater_success: 'Updated. Restart DSH to load the new version.',
      updater_unavailable: 'Automatic updates unavailable for this profile.',
    }

    const zh = {
      title: 'Web 网关',
      subtitle: '弹性网页搜索与提取回退链',
      header_desc: '在内置 web_search / web_fetch 触达限额时，使用 Tavily → Firecrawl → Exa → SearXNG 回退搜索，并提取页面内容。',
      'settings.loading': '正在加载 Web Gateway 设置…',
      'settings.unavailable': '设置不可用（宿主命名空间尚未就绪）。',
      'settings.retry': '重试',
      saved: '设置已保存',
      save: '保存',
      saving: '正在保存…',
      defaultLimit: '默认结果数',
      defaultLimitDesc: 'web_gateway_search 的默认最大结果数。',
      maxLimit: '结果硬上限',
      maxLimitDesc: '单次搜索最多返回的结果数。',
      timeoutMs: '提供商超时（毫秒）',
      timeoutMsDesc: '每个提供商的 HTTP 超时时间。',
      cacheTtlMs: '缓存 TTL（毫秒）',
      cacheTtlMsDesc: '内存结果缓存时间。0 表示禁用。',
      searxngUrl: 'SearXNG 地址',
      searxngUrlDesc: '可选本地 SearXNG。留空则禁用该回退。',
      crawl4aiUrl: 'Crawl4AI 地址',
      crawl4aiUrlDesc: '可选 crawl4ai 提取回退。留空则禁用。',
      tavilyApiKeyEnv: 'Tavily 凭证名',
      firecrawlApiKeyEnv: 'Firecrawl 凭证名',
      exaApiKeyEnv: 'Exa 凭证名',
      crawl4aiTokenEnv: 'Crawl4AI 凭证名',
      keysDesc: '请在「设置 → 凭证」中按这些名称保存密钥，不要把 API Key 写在这里。',
      allowInternalUrls: '允许内网提取 URL',
      allowInternalUrlsDesc: '危险：允许解析到回环/私有地址的提取目标。默认关闭。',
      updater_title: '插件版本',
      updater_current: '当前',
      updater_latest: '最新',
      updater_checking: '检查中…',
      updater_check: '检查更新',
      updater_updating: '更新中…',
      updater_update_now: '更新到 {version}',
      updater_up_to_date: '已是最新',
      updater_failed: '检查更新失败',
      updater_success: '已更新。请重启 DSH 以加载新版本。',
      updater_unavailable: '当前配置文件无法自动更新。',
    }

    function makeT(dict, fallback) {
      return function t(key, vars) {
        let val = (dict && dict[key]) || (fallback && fallback[key]) || key
        if (vars && typeof val === 'string') {
          for (const k of Object.keys(vars)) {
            val = val.replace(new RegExp('\\{' + k + '\\}', 'g'), String(vars[k]))
          }
        }
        return val
      }
    }

    function FallbackChevron() {
      return React.createElement('svg', {
        width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true',
      }, React.createElement('path', {
        d: 'M3.5 5.25L7 8.75L10.5 5.25', stroke: 'currentColor', strokeWidth: 1.5,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }))
    }
    const Chevron = ChevronIcon || FallbackChevron

    const STYLE = `
.wg-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none}
.wg-head{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;display:flex;align-items:center;gap:12px;padding:14px 16px}
.wg-title{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.wg-sub{color:var(--dsw-alias-label-secondary);font-size:13px}
.wg-chev{margin-left:auto;flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}
.wg-chev-open{transform:rotate(180deg)}
.wg-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.wg-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}
.wg-label{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500}
.wg-desc{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.4}
.wg-input{height:34px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px}
.wg-check{display:flex;align-items:center;gap:10px}
.wg-foot{border-top:1px solid var(--dsw-alias-border-l2);display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px}
.wg-save{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.wg-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 12px;font-size:12px;background:transparent;color:var(--dsw-alias-label-primary)}
.wg-alert-ok{color:var(--dsw-alias-state-success-primary);font-size:12px}
.wg-alert-bad{color:var(--dsw-alias-state-danger-primary);font-size:12px}
.wg-warn{border:1px solid var(--dsw-alias-state-warning-primary);border-radius:8px;padding:10px 12px;margin:8px 0;font-size:12px;color:var(--dsw-alias-state-warning-primary)}
`

    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-dsh-plugin="dsh-web-gateway"]')) return
      const style = document.createElement('style')
      style.dataset.dshPlugin = 'dsh-web-gateway'
      style.textContent = STYLE
      document.head.appendChild(style)
    }

    function Field({ id, label, desc, children }) {
      return React.createElement('div', { className: 'wg-field' },
        React.createElement('label', { className: 'wg-label', htmlFor: id }, label),
        children,
        desc ? React.createElement('div', { className: 'wg-desc' }, desc) : null,
      )
    }

    function UpdaterBlock({ t }) {
      const [currentVer, setCurrent] = React.useState('…')
      const [latestVer, setLatest] = React.useState('')
      const [updateAvailable, setAvail] = React.useState(false)
      const [canAuto, setCanAuto] = React.useState(false)
      const [loading, setLoading] = React.useState(false)
      const [updating, setUpdating] = React.useState(false)
      const [feedback, setFeedback] = React.useState({ text: '', ok: true })

      const load = React.useCallback(async () => {
        setLoading(true)
        try {
          const res = await fetch('/api/dsh-web-gateway/update', { method: 'GET', credentials: 'same-origin' })
          const data = await res.json()
          setCurrent(data.currentVersion || '?')
          setLatest(data.latestVersion || '')
          setAvail(!!data.updateAvailable)
          setCanAuto(!!data.canAutoUpdate)
          if (data.latestCheckFailed) setFeedback({ text: t('updater_failed'), ok: false })
          else if (!data.updateAvailable && data.latestVersion) setFeedback({ text: t('updater_up_to_date'), ok: true })
        } catch (e) {
          setFeedback({ text: t('updater_failed'), ok: false })
        }
        setLoading(false)
      }, [t])

      React.useEffect(() => { load() }, [load])

      const onUpdate = async () => {
        if (!canAuto || !latestVer) return
        setUpdating(true)
        try {
          const res = await fetch('/api/dsh-web-gateway/update', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', 'x-dsh-plugin-update': '1' },
            body: JSON.stringify({ version: latestVer }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(data.error || res.statusText)
          setFeedback({ text: t('updater_success'), ok: true })
          setAvail(false)
        } catch (e) {
          setFeedback({ text: String(e.message || e), ok: false })
        }
        setUpdating(false)
      }

      return React.createElement('div', { className: 'wg-field' },
        React.createElement('div', { className: 'wg-label' }, t('updater_title')),
        React.createElement('div', { className: 'wg-desc' },
          `${t('updater_current')}: v${currentVer}` + (latestVer ? ` · ${t('updater_latest')}: v${latestVer}` : '')),
        React.createElement('div', { style: { display: 'flex', gap: 8, marginTop: 6 } },
          React.createElement('button', { type: 'button', className: 'wg-btn', onClick: load, disabled: loading },
            loading ? t('updater_checking') : t('updater_check')),
          updateAvailable && canAuto
            ? React.createElement('button', { type: 'button', className: 'wg-save', onClick: onUpdate, disabled: updating },
              updating ? t('updater_updating') : t('updater_update_now', { version: latestVer }))
            : null,
        ),
        !canAuto ? React.createElement('div', { className: 'wg-desc' }, t('updater_unavailable')) : null,
        feedback.text ? React.createElement('div', { className: feedback.ok ? 'wg-alert-ok' : 'wg-alert-bad' }, feedback.text) : null,
      )
    }

    function SettingsBody({ ctx, t }) {
      const [snap, setSnap] = React.useState({ status: 'loading', value: {} })
      const [draft, setDraft] = React.useState({})
      const [saving, setSaving] = React.useState(false)
      const [msg, setMsg] = React.useState({ text: '', ok: true })
      const dirty = React.useRef(false)

      const defaults = {
        defaultLimit: 5, maxLimit: 20, timeoutMs: 30000, cacheTtlMs: 600000,
        searxngUrl: '', crawl4aiUrl: '',
        tavilyApiKeyEnv: 'TAVILY_API_KEY', firecrawlApiKeyEnv: 'FIRECRAWL_API_KEY',
        exaApiKeyEnv: 'EXA_API_KEY', crawl4aiTokenEnv: 'CRAWL4AI_TOKEN',
        allowInternalUrls: false,
      }

      React.useEffect(() => {
        let active = true
        try {
          const scope = ctx?.settingsScope?.bind?.({ namespace: NS })
          if (!scope) { setSnap({ status: 'unavailable', value: {} }); return () => {} }
          const applyVal = (res) => {
            setSnap({ status: 'ready', value: res || {} })
            if (!dirty.current) setDraft({ ...defaults, ...(res || {}) })
          }
          Promise.resolve(scope.get()).then((res) => { if (active) applyVal(res) }).catch(() => {
            if (active) setSnap({ status: 'unavailable', value: {} })
          })
          const unwatch = typeof scope.watch === 'function' ? scope.watch((next) => {
            if (active && next) applyVal(next)
          }) : () => {}
          return () => { active = false; try { unwatch() } catch (err) { void err } }
        } catch (_) {
          setSnap({ status: 'unavailable', value: {} })
          return () => {}
        }
      }, [ctx])

      const setField = (k, v) => {
        dirty.current = true
        setDraft((prev) => ({ ...prev, [k]: v }))
      }

      const onSave = async () => {
        const scope = ctx?.settingsScope?.bind?.({ namespace: NS })
        if (!scope) return
        setSaving(true)
        const keys = Object.keys(defaults)
        const errs = []
        for (const k of keys) {
          try { await scope.set(k, draft[k]) } catch (e) { errs.push(`${k}: ${e.message || e}`) }
        }
        setMsg(errs.length ? { text: errs.join('; '), ok: false } : { text: t('saved'), ok: true })
        if (!errs.length) dirty.current = false
        setSaving(false)
      }

      if (snap.status === 'loading') return React.createElement('div', { className: 'wg-desc' }, t('settings.loading'))
      if (snap.status === 'unavailable') return React.createElement('div', { className: 'wg-alert-bad' }, t('settings.unavailable'))

      const num = (id, key, label, desc) => Field({
        id, label: t(label), desc: t(desc),
        children: React.createElement('input', {
          id, className: 'wg-input', type: 'number', value: draft[key] ?? '',
          onChange: (e) => setField(key, Number(e.target.value)),
        }),
      })
      const text = (id, key, label, desc) => Field({
        id, label: t(label), desc: t(desc),
        children: React.createElement('input', {
          id, className: 'wg-input', type: 'text', value: draft[key] ?? '',
          onChange: (e) => setField(key, e.target.value),
        }),
      })

      return React.createElement('div', { className: 'wg-body' },
        React.createElement('div', { className: 'wg-desc', style: { paddingTop: 12 } }, t('header_desc')),
        num('wg-defaultLimit', 'defaultLimit', 'defaultLimit', 'defaultLimitDesc'),
        num('wg-maxLimit', 'maxLimit', 'maxLimit', 'maxLimitDesc'),
        num('wg-timeoutMs', 'timeoutMs', 'timeoutMs', 'timeoutMsDesc'),
        num('wg-cacheTtlMs', 'cacheTtlMs', 'cacheTtlMs', 'cacheTtlMsDesc'),
        text('wg-searxngUrl', 'searxngUrl', 'searxngUrl', 'searxngUrlDesc'),
        text('wg-crawl4aiUrl', 'crawl4aiUrl', 'crawl4aiUrl', 'crawl4aiUrlDesc'),
        React.createElement('div', { className: 'wg-desc' }, t('keysDesc')),
        text('wg-tavily', 'tavilyApiKeyEnv', 'tavilyApiKeyEnv', 'keysDesc'),
        text('wg-firecrawl', 'firecrawlApiKeyEnv', 'firecrawlApiKeyEnv', 'keysDesc'),
        text('wg-exa', 'exaApiKeyEnv', 'exaApiKeyEnv', 'keysDesc'),
        text('wg-crawl4ai-tok', 'crawl4aiTokenEnv', 'crawl4aiTokenEnv', 'keysDesc'),
        React.createElement('div', { className: 'wg-field' },
          React.createElement('label', { className: 'wg-check', htmlFor: 'wg-allow-internal' },
            React.createElement('input', {
              id: 'wg-allow-internal', type: 'checkbox',
              checked: !!draft.allowInternalUrls,
              onChange: (e) => setField('allowInternalUrls', e.target.checked),
            }),
            React.createElement('span', { className: 'wg-label' }, t('allowInternalUrls')),
          ),
          React.createElement('div', { className: draft.allowInternalUrls ? 'wg-warn' : 'wg-desc' }, t('allowInternalUrlsDesc')),
        ),
        React.createElement(UpdaterBlock, { t }),
        React.createElement('div', { className: 'wg-foot' },
          msg.text ? React.createElement('span', { className: msg.ok ? 'wg-alert-ok' : 'wg-alert-bad' }, msg.text) : null,
          React.createElement('button', { type: 'button', className: 'wg-save', onClick: onSave, disabled: saving },
            saving ? t('saving') : t('save')),
        ),
      )
    }

    function PluginCard(props) {
      ensureStyle()
      const [open, setOpen] = React.useState(false)
      const ctx = props.ctx || props.inject?.ctx
      const localeSnap = (typeof ctx?.locale?.getLocale === 'function' && ctx.locale.getLocale())
        || (typeof ctx?.locale?.getSnapshot === 'function' && ctx.locale.getSnapshot())
        || {}
      const active = String(localeSnap.active || localeSnap.locale || 'en').toLowerCase()
      const t = makeT(active.startsWith('zh') ? zh : en, en)
      const bound = typeof props.t === 'function' ? props.t : t

      return React.createElement('div', { className: 'wg-card' },
        React.createElement('button', {
          type: 'button', className: 'wg-head', 'aria-expanded': open,
          onClick: () => setOpen((v) => !v),
        },
          React.createElement('div', null,
            React.createElement('div', { className: 'wg-title' }, bound('title') || t('title')),
            React.createElement('div', { className: 'wg-sub' }, t('subtitle')),
          ),
          React.createElement('span', { className: 'wg-chev' + (open ? ' wg-chev-open' : '') },
            React.createElement(Chevron, null)),
        ),
        open ? React.createElement(SettingsBody, { ctx, t }) : null,
      )
    }

    exports.inject = ['slots', 'locale', 'settingsScope']
    exports.apply = function apply(clientCtx) {
      const ctx = clientCtx

      try {
        if (ctx.locale && typeof ctx.locale.register === 'function') {
          ctx.locale.register(NS, { en, zh })
        }
      } catch (err) {
        void err
      }

      function registerSlotWhenReady(slotName, registerFn) {
        if (!ctx.slots) return
        if (typeof ctx.slots.inject === 'function') {
          try {
            ctx.slots.inject(slotName, () => {
              try {
                return registerFn()
              } catch (err) {
                console.warn('[dsh-web-gateway] Error registering slot ' + slotName + ':', err)
              }
            })
            return
          } catch (err) {
            console.warn('[dsh-web-gateway] Failed to inject slot ' + slotName + ':', err)
          }
        }
        if (typeof ctx.slots.register === 'function') {
          try {
            registerFn()
          } catch (err) {
            console.warn('[dsh-web-gateway] Failed direct registration for ' + slotName + ':', err)
          }
        }
      }

      registerSlotWhenReady('settings.plugin.item', () =>
        ctx.slots.register(
          {
            name: 'settings.plugin.item',
            key: NS,
            order: 70,
            locale: NS,
            inject: () => ({ ctx }),
          },
          (props) => React.createElement(PluginCard, { ...props, ctx: (props && props.ctx) || ctx }),
        )
      )

      return () => {}
    }
    return module.exports
  },
})
