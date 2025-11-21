// xxtui 待办推送插件（beta）
// 说明：
// - 扫描当前文档中形如「- [ ] 任务内容」或「- [x] 任务内容」的行
// - 菜单提供推送（全部/已完成/未完成）与创建提醒两个入口
//   * 推送：立即调用 https://www.xxtui.com/xxtui/{apikey}
//   * 创建提醒：解析行尾 @YYYY-MM-DD HH:mm / @自然语言 调用 https://www.xxtui.com/scheduled/reminder/{apikey}
// - 配置通过插件设置页（openSettings）保存在 context.storage 中

// 配置存储键
const CFG_KEY = 'xxtui.todo.config'

// 默认配置
const DEFAULT_CFG = {
    apiKey: '',
    from: '飞速MarkDown',
    channel: ''
}

// 记录菜单解绑函数（按 plugin.md 推荐的返回值清理方式）
const CTX_MENU_DISPOSERS = []
let REMOVE_TOP_MENU = null

const MENU_ACTIONS = {
    PUSH_ALL: 'push_all',
    PUSH_DONE: 'push_done',
    PUSH_TODO: 'push_todo',
    CREATE_REMINDER: 'create_reminder'
}

// 日志开关，置为 true 可在控制台查看调试信息
const LOG_ENABLED = false
const log = (...args) => {
    if (!LOG_ENABLED) return
    try {
        console.log('[xxtui-todo]', ...args)
    } catch {
        // ignore console errors
    }
}

// 注入设置面板样式（仿 AI 助手风格，简化版）
function ensureXxtuiCss() {
    try {
        const doc = window && window.document ? window.document : null
        if (!doc) return
        if (doc.getElementById('xtui-todo-style')) return
        const css = doc.createElement('style')
        css.id = 'xtui-todo-style'
        css.textContent = [
            '#xtui-set-overlay{position:fixed;inset:0;background:rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;z-index:2147483600;}',
            '#xtui-set-dialog{width:420px;max-width:92vw;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.18);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,system-ui;}',
            '#xtui-set-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#f8fafc;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;}',
            '#xtui-set-head button{border:none;background:transparent;cursor:pointer;font-size:14px;color:#6b7280;}',
            '#xtui-set-body{padding:12px;}',
            '.xt-row{display:flex;align-items:center;gap:10px;margin:8px 0;}',
            '.xt-row label{width:110px;color:#334155;font-size:13px;}',
            '.xt-row input,.xt-row select{flex:1;background:#fff;border:1px solid #e5e7eb;color:#0f172a;border-radius:8px;padding:6px 10px;font-size:13px;}',
            '.xt-help{flex-direction:column;align-items:flex-start;border-radius:8px;background:#f9fafb;border:1px solid #e5e7eb;padding:8px 10px;}',
            '.xt-help-title{font-size:13px;font-weight:600;color:#111827;margin-bottom:4px;}',
            '.xt-help-text{font-size:12px;color:#4b5563;line-height:1.5;}',
            '#xtui-set-actions{display:flex;gap:10px;justify-content:flex-end;padding:10px 12px;border-top:1px solid #e5e7eb;background:#fafafa;}',
            '#xtui-set-actions button{padding:6px 12px;border-radius:8px;border:1px solid #e5e7eb;background:#ffffff;color:#0f172a;font-size:13px;cursor:pointer;}',
            '#xtui-set-actions button.primary{background:#2563eb;border-color:#2563eb;color:#fff;}'
        ].join('')
        doc.head.appendChild(css)
    } catch {
        // 忽略样式错误
    }
}

// 自定义确认弹窗样式（与设置面板风格保持一致）
function ensureConfirmCss() {
    try {
        const doc = window && window.document ? window.document : null
        if (!doc) return
        if (doc.getElementById('xtui-confirm-style')) return
        const css = doc.createElement('style')
        css.id = 'xtui-confirm-style'
        css.textContent = [
            '#xtui-confirm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:2147483601;}',
            '#xtui-confirm-dialog{width:360px;max-width:92vw;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.18);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,system-ui;}',
            '#xtui-confirm-head{padding:12px 14px;font-weight:600;color:#0f172a;border-bottom:1px solid #e5e7eb;background:#f8fafc;}',
            '#xtui-confirm-body{padding:14px;color:#111827;line-height:1.6;font-size:14px;}',
            '#xtui-confirm-actions{display:flex;justify-content:flex-end;gap:10px;padding:12px 14px;border-top:1px solid #e5e7eb;background:#fafafa;}',
            '#xtui-confirm-actions button{padding:6px 12px;border-radius:8px;border:1px solid #e5e7eb;background:#ffffff;color:#0f172a;font-size:13px;cursor:pointer;}',
            '#xtui-confirm-actions button.primary{background:#2563eb;border-color:#2563eb;color:#fff;}'
        ].join('')
        doc.head.appendChild(css)
    } catch {}
}

// 自定义确认弹窗，返回 Promise<boolean>
function showConfirm(message) {
    return new Promise((resolve) => {
        try {
            const doc = window && window.document ? window.document : null
            if (!doc) throw new Error('NO_DOM')
            ensureConfirmCss()

            const overlay = doc.createElement('div')
            overlay.id = 'xtui-confirm-overlay'
            overlay.innerHTML = [
                '<div id="xtui-confirm-dialog">',
                ' <div id="xtui-confirm-head">确认操作</div>',
                ' <div id="xtui-confirm-body"></div>',
                ' <div id="xtui-confirm-actions">',
                '   <button id="xtui-confirm-cancel">取消</button>',
                '   <button class="primary" id="xtui-confirm-ok">确定</button>',
                ' </div>',
                '</div>'
            ].join('')

            const body = overlay.querySelector('#xtui-confirm-body')
            if (body) body.textContent = String(message || '')

            const host = doc.body || doc.documentElement
            host.appendChild(overlay)

            const cleanup = (ret) => {
                try { overlay.remove() } catch {}
                resolve(!!ret)
            }

            const btnOk = overlay.querySelector('#xtui-confirm-ok')
            const btnCancel = overlay.querySelector('#xtui-confirm-cancel')
            if (btnOk) btnOk.addEventListener('click', () => cleanup(true))
            if (btnCancel) btnCancel.addEventListener('click', () => cleanup(false))
            overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false) })
            const onKey = (e) => {
                if (e.key === 'Escape') cleanup(false)
                if (e.key === 'Enter') cleanup(true)
            }
            try { doc.addEventListener('keydown', onKey, { once: true }) } catch {}
        } catch {
            resolve(false)
        }
    })
}

// 加载配置
async function loadCfg(context) {
    try {
        if (!context || !context.storage || !context.storage.get) return { ...DEFAULT_CFG }
        const raw = await context.storage.get(CFG_KEY)
        if (!raw || typeof raw !== 'object') return { ...DEFAULT_CFG }
        const merged = { ...DEFAULT_CFG, ...raw }
        log('配置已加载', { hasKey: !!merged.apiKey, from: merged.from, channel: !!merged.channel })
        return merged
    } catch {
        return { ...DEFAULT_CFG }
    }
}

// 保存配置
async function saveCfg(context, cfg) {
    try {
        if (!context || !context.storage || !context.storage.set) return
        await context.storage.set(CFG_KEY, cfg || { ...DEFAULT_CFG })
    } catch {
        // 忽略存储错误
    }
}

// 从文档内容中提取所有待办（识别「- [ ] 文本」/「- [x] 文本」以及 * 列表）
function extractTodos(text) {
    const src = String(text || '')
    const lines = src.split(/\r?\n/)
    const out = []

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i]
        if (!raw) continue
        const m = raw.match(/^\s*[-*]\s+\[(\s|x|X)\]\s+(.+)$/)
        if (!m) continue
        const title = String(m[2] || '').trim()
        if (!title) continue
        const marker = String(m[1] || '').trim().toLowerCase()
        out.push({
            title,
            content: raw,
            line: i + 1,
            done: marker === 'x'
        })
    }

    return out
}

function filterTodosByType(todos, type) {
    const list = Array.isArray(todos) ? todos : []
    if (type === MENU_ACTIONS.PUSH_DONE) return list.filter((item) => item && item.done)
    if (type === MENU_ACTIONS.PUSH_TODO) return list.filter((item) => item && !item.done)
    return list.slice()
}

function describeFilter(type) {
    if (type === MENU_ACTIONS.PUSH_DONE) return '已完成'
    if (type === MENU_ACTIONS.PUSH_TODO) return '未完成'
    return '全部'
}

function todoStatusTag(todo) {
    return todo && todo.done ? '[DONE]' : '[TODO]'
}

// 解析表达式（@ 后面的部分），返回秒级时间戳
function parseTimeExpr(expr, nowSec) {
    const s = String(expr || '').trim()
    if (!s) return 0

    // 1. 显式日期时间：YYYY-MM-DD HH[:mm]
    {
        const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2})(?::(\d{1,2}))?$/)
        if (m) {
            const y = parseInt(m[1], 10) || 0
            const mo = parseInt(m[2], 10) || 0
            const d = parseInt(m[3], 10) || 0
            const h = parseInt(m[4], 10) || 0
            const mi = m[5] != null ? (parseInt(m[5], 10) || 0) : 0
            if (y && mo && d) {
                const dt = new Date(y, mo - 1, d, h, mi, 0, 0)
                return Math.floor(dt.getTime() / 1000)
            }
        }
    }

    // 2. 仅时间（今天或次日）：HH[:mm] / HH点[mm分]
    {
        let mt = s.match(/^(\d{1,2})(?::(\d{1,2}))?$/)
        if (!mt) mt = s.match(/^(\d{1,2})点(?:(\d{1,2})分?)?$/)
        if (mt) {
            const base = new Date(nowSec * 1000)
            const y = base.getFullYear()
            const mo = base.getMonth()
            const d = base.getDate()
            const h = parseInt(mt[1], 10) || 0
            const mi = mt[2] != null ? (parseInt(mt[2], 10) || 0) : 0
            const dt = new Date(y, mo, d, h, mi, 0, 0)
            let ts = Math.floor(dt.getTime() / 1000)
            if (ts <= nowSec) ts += 24 * 3600
            return ts
        }
    }

    // 3. 简单中文相对日期 + 时段：今天/明天/后天 [早上/下午/晚上] [HH[:mm]]
    {
        const m = s.match(/^(今天|明天|后天)\s*(早上|上午|中午|下午|晚上|晚|今晚)?\s*(\d{1,2})?(?::(\d{1,2}))?$/)
        if (m) {
            const word = m[1]
            const period = m[2] || ''
            const hRaw = m[3]
            const miRaw = m[4]

            let addDay = 0
            if (word === '明天') addDay = 1
            else if (word === '后天') addDay = 2

            let h = 9
            if (hRaw != null) {
                h = parseInt(hRaw, 10) || 0
            } else if (period) {
                if (period === '中午') h = 12
                else if (period === '下午') h = 15
                else if (period === '晚上' || period === '晚' || period === '今晚') h = 20
                else h = 9
            }

            const mi = miRaw != null ? (parseInt(miRaw, 10) || 0) : 0

            const base = new Date(nowSec * 1000)
            const y = base.getFullYear()
            const mo = base.getMonth()
            const d = base.getDate() + addDay
            const dt = new Date(y, mo, d, h, mi, 0, 0)
            return Math.floor(dt.getTime() / 1000)
        }
    }

    // 4. 简单相对时间：X小时后 / X分钟后
    {
        const mHour = s.match(/^(\d+)\s*(小时|h|H)后$/)
        if (mHour) {
            const n = parseInt(mHour[1], 10) || 0
            if (n > 0) return nowSec + n * 3600
        }
        const mMin = s.match(/^(\d+)\s*(分钟|分)后$/)
        if (mMin) {
            const n = parseInt(mMin[1], 10) || 0
            if (n > 0) return nowSec + n * 60
        }
    }

    return 0
}

// 解析待办标题中的时间，支持：
// - @YYYY-MM-DD HH:mm / @YYYY-MM-DD HH
// - @HH:mm / @HH点
// - @明天 9:00 / @后天下午 / @2小时后 等
function parseTodoTime(title, nowSec) {
    const raw = String(title || '').trim()
    if (!raw) return null
    const idx = raw.lastIndexOf('@')
    if (idx < 0) return null

    const text = String(raw.slice(0, idx)).trim()
    const expr = String(raw.slice(idx + 1)).trim()
    if (!expr) return null

    const ts = parseTimeExpr(expr, nowSec)
    if (!ts || !Number.isFinite(ts)) return null
    if (ts <= nowSec) return null

    return {
        title: text || raw,
        reminderTime: ts
    }
}

// 立即推送单条待办到 xxtui
async function pushInstantBatch(context, cfg, todos, filterLabel) {
    const key = String(cfg && cfg.apiKey || '').trim()
    if (!key) throw new Error('NO_API_KEY')
    const list = Array.isArray(todos) ? todos.filter(Boolean) : []
    if (!list.length) throw new Error('NO_TODO')

    const label = filterLabel || '全部'
    const url = 'https://www.xxtui.com/xxtui/' + encodeURIComponent(key)
    const lines = []
    lines.push('提醒列表（' + label + '，共 ' + list.length + ' 条）：')
    lines.push('')
    list.forEach((todo, idx) => {
        const text = String(todo && todo.title || '').trim() || '待办事项'
        const status = todoStatusTag(todo)
        const lineNum = todo && todo.line ? '（行 ' + todo.line + '）' : ''
        lines.push((idx + 1) + '. ' + status + ' ' + text + lineNum)
    })
    lines.push('')
    lines.push('来源：' + ((cfg && cfg.from) || '飞速MarkDown'))

    const payload = {
        from: (cfg && cfg.from) || '飞速MarkDown',
        title: '[TODO] ' + label + ' · ' + list.length + ' 条',
        content: lines.join('\n'),
        channel: cfg && cfg.channel ? String(cfg.channel) : ''
    }

    if (!payload.channel) {
        delete payload.channel
    }

    log('批量推送发送', { label, count: list.length, channel: payload.channel ? '自定义渠道' : '默认渠道' })

    try {
        await context.http.fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        log('批量推送成功')
    } catch (err) {
        log('批量推送出错', err)
        throw err
    }
}

// 创建定时提醒
async function pushScheduledTodo(context, cfg, todo) {
    const key = String(cfg && cfg.apiKey || '').trim()
    if (!key) throw new Error('NO_API_KEY')
    const ts = todo && todo.reminderTime ? Number(todo.reminderTime) : 0
    if (!ts || !Number.isFinite(ts)) throw new Error('BAD_TIME')

    const url = 'https://www.xxtui.com/scheduled/reminder/' + encodeURIComponent(key)
    const text = String(todo && todo.title || '').trim()
    const title = '[TODO] ' + (text || '待办事项')
    const lines = []
    const mainText = text || title
    lines.push('提醒内容:')
    lines.push(mainText)
    // 追加具体提醒时间
    try {
        const d = new Date(ts * 1000)
        if (Number.isFinite(d.getTime())) {
            const pad = (n) => (n < 10 ? '0' + n : '' + n)
            const s = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
                ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
            lines.push('')
            lines.push('提醒时间：' + s)
        }
    } catch {
        // 时间格式失败时忽略
    }
    lines.push('来源：' + ((cfg && cfg.from) || '飞速MarkDown'))

    const payload = {
        title,
        content: lines.join('\n'),
        reminderTime: ts
    }

    log('定时提醒发送', { title, ts })

    try {
        await context.http.fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        log('定时提醒成功')
    } catch (err) {
        log('定时提醒出错', err)
        throw err
    }
}

async function runPushFlow(context, cfg, type) {
    log('开始推送流程', { type })

    if (!context || !context.getEditorValue) {
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('当前环境不支持读取待办内容', 'err', 2600)
        }
        return
    }

    const content = context.getEditorValue()
    const allTodos = extractTodos(content)
    log('解析到待办数量', allTodos.length)
    if (!allTodos.length) {
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('当前文档没有待办（- [ ] 或 - [x] 语法）', 'err', 2600)
        }
        return
    }

    const filtered = filterTodosByType(allTodos, type)
    if (!filtered.length) {
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('没有符合筛选条件的待办', 'err', 2600)
        }
        return
    }

    const label = describeFilter(type)
    const confirmText = '检测到 ' + filtered.length + ' 条' + label + '待办，是否推送到 xxtui？（beta）'
    const okConfirm = await showConfirm(confirmText)
    if (!okConfirm) return

    try {
        await pushInstantBatch(context, cfg, filtered, label)
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('xxtui 推送完成：已发送 ' + filtered.length + ' 条（beta）', 'ok', 3600)
        }
    } catch (err) {
        const msg = err && err.message ? String(err.message) : '推送失败'
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('xxtui 推送失败：' + msg + '（beta）', 'err', 3600)
        }
    }
}

async function runReminderFlow(context, cfg) {
    log('开始提醒流程')

    if (!context || !context.getEditorValue) {
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('当前环境不支持读取待办内容', 'err', 2600)
        }
        return
    }

    const content = context.getEditorValue()
    const allTodos = extractTodos(content)
    log('解析到待办数量（提醒）', allTodos.length)
    if (!allTodos.length) {
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('当前文档没有待办（- [ ] 或 - [x] 语法）', 'err', 2600)
        }
        return
    }
    const pending = allTodos.filter((item) => item && !item.done)
    if (!pending.length) {
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('当前文档没有未完成的待办', 'err', 2600)
        }
        return
    }

    const nowSec = Math.floor(Date.now() / 1000)
    const scheduled = []
    for (const todo of pending) {
        const parsed = parseTodoTime(todo.title, nowSec)
        if (!parsed) continue
        scheduled.push({
            ...todo,
            title: parsed.title,
            reminderTime: parsed.reminderTime
        })
    }

    log('可创建提醒的待办数', scheduled.length)

    if (!scheduled.length) {
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('未找到包含有效时间（@...）的未完成待办，无法创建定时提醒（beta）', 'err', 3600)
        }
        return
    }

    const okConfirm = await showConfirm(
        '检测到 ' + scheduled.length + ' 条包含时间的未完成待办，是否创建 xxtui 定时提醒？（beta）'
    )
    if (!okConfirm) return

    let okCount = 0
    let failCount = 0
    for (const todo of scheduled) {
        try {
            await pushScheduledTodo(context, cfg, todo)
            okCount++
        } catch {
            failCount++
        }
    }

    const msgSchedule = failCount
        ? 'xxtui 定时提醒创建完成：成功 ' + okCount + ' 条，失败 ' + failCount + ' 条（beta）'
        : 'xxtui 定时提醒创建完成：成功 ' + okCount + ' 条（beta）'
    if (context && context.ui && context.ui.notice) {
        context.ui.notice(msgSchedule, failCount ? 'err' : 'ok', 4000)
    }
}

async function handleMenuAction(context, action) {
    try {
        log('处理菜单动作', action)

        if (!context || !context.http || !context.http.fetch) {
            if (context && context.ui && context.ui.notice) {
                context.ui.notice('当前环境不支持待办推送所需接口', 'err', 2600)
            }
            return
        }

        const cfg = await loadCfg(context)
        const key = String(cfg.apiKey || '').trim()
        if (!key) {
            if (context && context.ui && context.ui.notice) {
                context.ui.notice('请先在插件设置中配置 xxtui API Key（beta）', 'err', 3200)
            }
            return
        }

        if (action === MENU_ACTIONS.CREATE_REMINDER) {
            await runReminderFlow(context, cfg)
            return
        }

        if (
            action === MENU_ACTIONS.PUSH_ALL ||
            action === MENU_ACTIONS.PUSH_DONE ||
            action === MENU_ACTIONS.PUSH_TODO
        ) {
            await runPushFlow(context, cfg, action)
            return
        }
    } catch (e) {
        const msg = e && e.message ? String(e.message) : String(e || '未知错误')
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('xxtui 待办操作失败：' + msg + '（beta）', 'err', 4000)
        }
        log('处理菜单动作异常', e)
    }
}

export function activate(context) {
    // 检查必要能力是否存在
    if (!context || !context.getEditorValue || !context.http || !context.http.fetch) {
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('当前环境不支持待办推送所需接口', 'err', 2600)
        }
        return
    }

    // 顶部菜单
    try { if (REMOVE_TOP_MENU) { REMOVE_TOP_MENU(); REMOVE_TOP_MENU = null } } catch {}
    try {
        REMOVE_TOP_MENU = context.addMenuItem({
            label: '待办',
            title: '推送或创建 xxtui 提醒（beta）',
            children: [
                { type: 'group', label: '推送' },
                {
                    label: '全部',
                    note: '含已完成/未完成',
                    onClick: () => handleMenuAction(context, MENU_ACTIONS.PUSH_ALL)
                },
                {
                    label: '已完成',
                    onClick: () => handleMenuAction(context, MENU_ACTIONS.PUSH_DONE)
                },
                {
                    label: '未完成',
                    onClick: () => handleMenuAction(context, MENU_ACTIONS.PUSH_TODO)
                },
                { type: 'divider' },
                { type: 'group', label: '提醒' },
                {
                    label: '创建提醒',
                    note: '@时间',
                    onClick: () => handleMenuAction(context, MENU_ACTIONS.CREATE_REMINDER)
                }
            ]
        })
    } catch {}

    // 右键菜单入口：同样提供推送/提醒的快捷操作
    try {
        if (context.addContextMenuItem) {
            // 防止重复注册：先清理旧的
            try {
                while (CTX_MENU_DISPOSERS.length) {
                    const d = CTX_MENU_DISPOSERS.pop()
                    try { typeof d === 'function' && d() } catch {}
                }
            } catch {}

            const condition = (ctx) => !ctx || ctx.mode === 'edit' || ctx.mode === 'wysiwyg'

            // 一级：推送（含二级细分）
            const pushDisposer = context.addContextMenuItem({
                label: '推送待办',
                icon: '📤',
                condition,
                children: [
                    {
                        label: '推送全部',
                        icon: '📝',
                        onClick: () => handleMenuAction(context, MENU_ACTIONS.PUSH_ALL)
                    },
                    {
                        label: '推送已完成',
                        icon: '✅',
                        onClick: () => handleMenuAction(context, MENU_ACTIONS.PUSH_DONE)
                    },
                    {
                        label: '推送未完成',
                        icon: '⭕',
                        onClick: () => handleMenuAction(context, MENU_ACTIONS.PUSH_TODO)
                    }
                ]
            })

            // 一级：创建提醒（单项）
            const reminderDisposer = context.addContextMenuItem({
                    label: '创建提醒 (@时间)',
                    icon: '⏰',
                    condition,
                    onClick: () => handleMenuAction(context, MENU_ACTIONS.CREATE_REMINDER)
                })

            ;[pushDisposer, reminderDisposer].forEach((d) => {
                if (typeof d === 'function') CTX_MENU_DISPOSERS.push(d)
            })
        }
    } catch (e) {
        log('右键菜单注册失败', e && e.message ? e.message : e)
    }
}

export async function openSettings(context) {
    try {
        if (!context || !context.storage || !context.storage.get || !context.storage.set) {
            if (context && context.ui && context.ui.notice) {
                context.ui.notice('当前环境不支持插件配置存储', 'err', 2600)
            }
            return
        }

        const cfg = await loadCfg(context)
        ensureXxtuiCss()

        const doc = window && window.document ? window.document : null
        if (!doc) {
            context.ui.notice('环境不支持设置面板', 'err', 2600)
            return
        }

        let overlay = doc.getElementById('xtui-set-overlay')
        if (overlay) {
            try { overlay.remove() } catch {}
        }

        overlay = doc.createElement('div')
        overlay.id = 'xtui-set-overlay'
        overlay.innerHTML = [
            '<div id="xtui-set-dialog">',
            ' <div id="xtui-set-head"><div id="xtui-set-title">xxtui 待办推送 设置</div><button id="xtui-set-close" title="关闭">×</button></div>',
            ' <div id="xtui-set-body">',
            '  <div class="xt-row xt-help">',
            '    <div class="xt-help-title">用法示例</div>',
            '    <div class="xt-help-text">',
            '      <div>- [ ] 写周报 @2025-11-21 09:00</div>',
            '      <div>- [ ] 开会 @明天 下午3点</div>',
            '      <div>- [ ] 打电话 @2小时后</div>',
            '      <div style="margin-top:4px;">创建提醒仅处理包含 @时间 的未完成待办。</div>',
            '      <div style="margin-top:4px;"><a href="https://www.xxtui.com/" target="_blank" rel="noopener noreferrer">打开 xxtui 官网</a></div>',
            '    </div>',
            '  </div>',
            '  <div class="xt-row"><label>API Key</label><input id="xtui-set-key" type="text" placeholder="在 xxtui 渠道管理中查看 apikey"/></div>',
            '  <div class="xt-row"><label>渠道 channel</label><input id="xtui-set-channel" type="text" placeholder="可留空，使用 xxtui 默认渠道"/></div>',
            '  <div class="xt-row"><label>来源 from</label><input id="xtui-set-from" type="text" placeholder="飞速MarkDown"/></div>',
            ' </div>',
            ' <div id="xtui-set-actions"><button id="xtui-set-cancel">取消</button><button class="primary" id="xtui-set-ok">保存</button></div>',
            '</div>'
        ].join('')

        const host = doc.body || doc.documentElement
        host.appendChild(overlay)

        const elKey = overlay.querySelector('#xtui-set-key')
        const elChannel = overlay.querySelector('#xtui-set-channel')
        const elFrom = overlay.querySelector('#xtui-set-from')

        if (elKey) elKey.value = cfg.apiKey || ''
        if (elChannel) elChannel.value = cfg.channel || ''
        if (elFrom) elFrom.value = cfg.from || '飞速MarkDown'

        const close = () => {
            try { overlay.remove() } catch {}
        }

        const btnClose = overlay.querySelector('#xtui-set-close')
        if (btnClose) btnClose.addEventListener('click', close)

        const btnCancel = overlay.querySelector('#xtui-set-cancel')
        if (btnCancel) btnCancel.addEventListener('click', close)

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close()
        })

        const onEsc = (e) => {
            if (e.key === 'Escape') {
                close()
                try { window.removeEventListener('keydown', onEsc) } catch {}
            }
        }
        try { window.addEventListener('keydown', onEsc) } catch {}

        const btnOk = overlay.querySelector('#xtui-set-ok')
        if (btnOk) {
            btnOk.addEventListener('click', async () => {
                const apiKey = elKey ? String(elKey.value || '').trim() : ''
                const channel = elChannel ? String(elChannel.value || '').trim() : ''
                const from = elFrom ? String(elFrom.value || '').trim() || '飞速MarkDown' : '飞速MarkDown'

                const nextCfg = {
                    apiKey,
                    channel,
                    from
                }

                await saveCfg(context, nextCfg)
                if (context.ui && context.ui.notice) {
                    context.ui.notice('xxtui 配置已保存（beta）', 'ok', 2000)
                }
                close()
            })
        }
    } catch (e) {
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('xxtui 配置保存失败（beta）', 'err', 2600)
        }
    }
}

function removeElById(id) {
    try {
        const doc = window && window.document ? window.document : null
        if (!doc) return
        const el = doc.getElementById(id)
        if (el) el.remove()
    } catch {}
}

export function deactivate() {
    // 解绑右键菜单
    try {
        while (CTX_MENU_DISPOSERS.length) {
            const d = CTX_MENU_DISPOSERS.pop()
            try { typeof d === 'function' && d() } catch {}
        }
    } catch {}

    // 解绑顶部菜单
    try {
        if (typeof REMOVE_TOP_MENU === 'function') {
            REMOVE_TOP_MENU()
        }
    } catch {}
    REMOVE_TOP_MENU = null

    // 清理样式和残留浮层
    removeElById('xtui-todo-style')
    removeElById('xtui-confirm-style')
    removeElById('xtui-set-overlay')
    removeElById('xtui-confirm-overlay')
}
