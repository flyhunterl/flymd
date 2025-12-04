// xxtui 待办推送插件
// 说明：
// - 扫描当前文档中形如「- [ ] 任务内容」或「- [x] 任务内容」的行
// - 菜单提供推送（全部/已完成/未完成）与创建提醒两个入口
//   * 推送：立即调用 https://www.xxtui.com/xxtui/{apikey}
//   * 创建提醒：解析行尾 @YYYY-MM-DD HH:mm / @自然语言 调用 https://www.xxtui.com/scheduled/reminder/{apikey}
// - 配置通过插件设置页（openSettings）保存在 context.storage 中

// 配置存储键
const CFG_KEY = 'xxtui.todo.config'

// 弹窗提示状态存储键
const PROMPT_STATUS_KEY = 'xxtui.todo.promptStatus'

// 默认配置
const DEFAULT_CFG = {
    apiKey: '', // 兼容旧版
    apiKeys: [], // { key: string, note?: string, isDefault?: boolean, channel?: string }[],
    from: '飞速MarkDown',
    enableWriteback: true, // 推送/提醒后是否回写标记
    pushFlag: '[pushed]', // 已推送标记文本
    remindFlag: '[reminded]' // 已创建提醒标记文本
}

// 默认提示状态配置
const DEFAULT_PROMPT_STATUS = {
    showConvertTodoPrompt: true // 是否显示转换为待办的提示
}

// 记录菜单解绑函数（按 plugin.md 推荐的返回值清理方式）
const CTX_MENU_DISPOSERS = []
let REMOVE_TOP_MENU = null
let PLUGIN_CONTEXT = null // 保存 context 以便重新注册菜单

const MENU_ACTIONS = {
    PUSH_ALL: 'push_all',
    PUSH_DONE: 'push_done',
    PUSH_TODO: 'push_todo',
    CREATE_REMINDER: 'create_reminder'
}

// 待办状态标记（追加在行尾，便于下次跳过）
const TODO_FLAG_PUSHED = 'pushed'
const TODO_FLAG_REMINDED = 'reminded'
const TODO_FLAG_MAP = {
    [TODO_FLAG_PUSHED]: '[pushed]',
    [TODO_FLAG_REMINDED]: '[reminded]'
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

// 检查是否有选中文本
function hasSelectedText(selectedText) {
    try {
        return selectedText && selectedText.trim().length > 0
    } catch {
        return false
    }
}

// 统一获取选中的原始 Markdown 文本（优先使用宿主提供的新 API）
function getSelectedMarkdownOrText(context, ctx) {
    try {
        // 1) 优先使用宿主提供的 getSelectedMarkdown（返回原始 Markdown）
        if (context && typeof context.getSelectedMarkdown === 'function') {
            const text = context.getSelectedMarkdown()
            if (typeof text === 'string' && hasSelectedText(text)) {
                return text
            }
        }

        // 2) 回退到右键菜单提供的选中文本
        if (ctx && typeof ctx.selectedText === 'string' && hasSelectedText(ctx.selectedText)) {
            return ctx.selectedText
        }

        // 3) 最后回退到旧的 getSelection 接口
        if (context && typeof context.getSelection === 'function') {
            const sel = context.getSelection()
            if (sel && typeof sel.text === 'string' && hasSelectedText(sel.text)) {
                return sel.text
            }
            if (typeof sel === 'string' && hasSelectedText(sel)) {
                return sel
            }
        }
    } catch {
        // ignore
    }
    return ''
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
            '#xtui-set-dialog{width:720px;max-width:96vw;height:620px;max-height:90vh;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.18);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,system-ui;display:flex;flex-direction:column;}',
            '#xtui-set-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#f8fafc;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;}',
            '#xtui-set-head button{border:none;background:transparent;cursor:pointer;font-size:14px;color:#6b7280;}',
            '#xtui-set-body{padding:0;display:flex;min-height:420px;flex:1;overflow:hidden;}',
            '#xtui-set-nav{width:168px;background:#f9fafb;border-right:1px solid #e5e7eb;display:flex;flex-direction:column;padding:10px 8px;gap:6px;box-sizing:border-box;}',
            '.xtui-nav-btn{border:1px solid transparent;border-radius:10px;background:transparent;padding:8px 10px;text-align:left;font-size:13px;color:#334155;cursor:pointer;transition:all .15s;}',
            '.xtui-nav-btn:hover{background:#eef2ff;border-color:#dfe3f3;}',
            '.xtui-nav-btn.active{background:#2563eb;color:#fff;border-color:#2563eb;box-shadow:0 6px 16px rgba(37,99,235,0.18);}',
            '#xtui-set-panel{flex:1;padding:12px;overflow:auto;box-sizing:border-box;}',
            '.xtui-tab{display:none;}',
            '.xtui-tab.active{display:block;}',
            '.xt-row{display:flex;align-items:center;gap:10px;margin:8px 0;}',
            '.xt-row label{width:110px;color:#334155;font-size:13px;}',
            '.xt-row input,.xt-row select,.xt-row textarea{flex:1;background:#fff;border:1px solid #e5e7eb;color:#0f172a;border-radius:8px;padding:6px 10px;font-size:13px;font-family:-apple-system,BlinkMacSystemFont,system-ui;box-sizing:border-box;}',
            '.xt-row textarea{min-height:90px;resize:vertical;}',
            '.xt-keys{margin-top:6px;border:1px solid #e5e7eb;border-radius:10px;padding:8px;background:#f9fafb;}',
            '.xt-keys-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;}',
            '.xt-keys-list{display:flex;flex-direction:column;gap:8px;max-height:260px;overflow-y:auto;}',
            '.xt-key-item{display:grid;grid-template-columns:1.5fr 1fr 1fr auto auto;gap:8px;align-items:center;padding:8px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;}',
            '.xt-key-item input[type="text"]{width:100%;}',
            '.xt-key-item .xt-radio{display:flex;align-items:center;gap:6px;}',
            '.xt-key-item button{border:1px solid #e5e7eb;border-radius:6px;background:#fff;padding:4px 8px;cursor:pointer;font-size:12px;}',
            '.xt-small-btn{padding:4px 10px;border:1px solid #2563eb;background:#2563eb;color:#fff;border-radius:8px;font-size:12px;cursor:pointer;}',
            '.xt-help{flex-direction:column;align-items:flex-start;border-radius:8px;background:#f9fafb;border:1px solid #e5e7eb;padding:8px 10px;}',
            '.xt-help-title{font-size:13px;font-weight:600;color:#111827;margin-bottom:4px;}',
            '.xt-help-text{font-size:12px;color:#4b5563;line-height:1.5;}',
            '.xt-help-text code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11px;color:#0f172a;}',
            '.xt-help-text strong{font-weight:600;color:#0f172a;}',
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

// 选择 Key 弹窗样式
function ensureKeyPickerCss() {
    try {
        const doc = window && window.document ? window.document : null
        if (!doc) return
        if (doc.getElementById('xtui-picker-style')) return
        const css = doc.createElement('style')
        css.id = 'xtui-picker-style'
        css.textContent = [
            '#xtui-picker-overlay{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:2147483601;}',
            '#xtui-picker-dialog{width:480px;max-width:92vw;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.18);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,system-ui;}',
            '#xtui-picker-head{padding:12px 14px;font-weight:600;color:#0f172a;border-bottom:1px solid #e5e7eb;background:#f8fafc;}',
            '#xtui-picker-body{padding:14px;max-height:420px;overflow:auto;}',
            '.xt-picker-section{margin-bottom:16px;}',
            '.xt-picker-section:last-child{margin-bottom:0;}',
            '.xt-picker-label{font-size:13px;font-weight:600;color:#111827;margin-bottom:8px;}',
            '.xt-picker-options{display:flex;flex-direction:column;gap:6px;}',
            '.xt-picker-option{display:flex;align-items:center;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;cursor:pointer;transition:all 0.15s;}',
            '.xt-picker-option:hover{background:#f9fafb;border-color:#2563eb;}',
            '.xt-picker-option.selected{background:#eff6ff;border-color:#2563eb;}',
            '.xt-picker-option input[type="radio"]{margin-right:10px;}',
            '.xt-picker-option-text{flex:1;}',
            '.xt-picker-option-main{font-size:14px;color:#0f172a;font-weight:500;}',
            '.xt-picker-option-sub{font-size:12px;color:#6b7280;margin-top:2px;}',
            '#xtui-picker-actions{display:flex;justify-content:flex-end;gap:10px;padding:12px 14px;border-top:1px solid #e5e7eb;background:#fafafa;}',
            '#xtui-picker-actions button{padding:6px 12px;border-radius:8px;border:1px solid #e5e7eb;background:#ffffff;color:#0f172a;font-size:13px;cursor:pointer;}',
            '#xtui-picker-actions button.primary{background:#2563eb;border-color:#2563eb;color:#fff;}',
            '#xtui-picker-actions button:disabled{opacity:0.5;cursor:not-allowed;}'
        ].join('')
        doc.head.appendChild(css)
    } catch {}
}

// 选择 Key 和推送类型弹窗，返回 Promise<{keyObj, action} | null>
function showKeyPicker(allKeys, defaultKey) {
    return new Promise((resolve) => {
        try {
            const doc = window && window.document ? window.document : null
            if (!doc) throw new Error('NO_DOM')
            if (!Array.isArray(allKeys) || !allKeys.length) {
                resolve(null)
                return
            }

            ensureKeyPickerCss()

            const overlay = doc.createElement('div')
            overlay.id = 'xtui-picker-overlay'

            let selectedKey = defaultKey || allKeys[0]
            let selectedAction = MENU_ACTIONS.PUSH_ALL

            const renderDialog = () => {
                overlay.innerHTML = [
                    '<div id="xtui-picker-dialog">',
                    ' <div id="xtui-picker-head">选择 Key 推送</div>',
                    ' <div id="xtui-picker-body">',
                    '   <div class="xt-picker-section">',
                    '     <div class="xt-picker-label">选择 API Key</div>',
                    '     <div class="xt-picker-options" id="xtui-picker-keys"></div>',
                    '   </div>',
                    '   <div class="xt-picker-section">',
                    '     <div class="xt-picker-label">选择推送类型</div>',
                    '     <div class="xt-picker-options" id="xtui-picker-actions"></div>',
                    '   </div>',
                    ' </div>',
                    ' <div id="xtui-picker-actions">',
                    '   <button id="xtui-picker-cancel">取消</button>',
                    '   <button class="primary" id="xtui-picker-ok">确定推送</button>',
                    ' </div>',
                    '</div>'
                ].join('')

                // 渲染 Key 选项
                const keysContainer = overlay.querySelector('#xtui-picker-keys')
                if (keysContainer) {
                    allKeys.forEach((keyItem, idx) => {
                        const option = doc.createElement('div')
                        option.className = 'xt-picker-option' + (keyItem === selectedKey ? ' selected' : '')

                        const radio = doc.createElement('input')
                        radio.type = 'radio'
                        radio.name = 'xtui-key'
                        radio.checked = keyItem === selectedKey

                        const textDiv = doc.createElement('div')
                        textDiv.className = 'xt-picker-option-text'

                        const mainText = doc.createElement('div')
                        mainText.className = 'xt-picker-option-main'
                        const isDefault = defaultKey && keyItem === defaultKey
                        mainText.textContent = describeKey(keyItem) + (isDefault ? ' （默认）' : '')

                        const subText = doc.createElement('div')
                        subText.className = 'xt-picker-option-sub'
                        const channelText = keyItem.channel ? '渠道: ' + keyItem.channel : '默认渠道'
                        subText.textContent = 'Key: ' + keyItem.key + ' | ' + channelText

                        textDiv.appendChild(mainText)
                        textDiv.appendChild(subText)

                        option.appendChild(radio)
                        option.appendChild(textDiv)

                        option.addEventListener('click', () => {
                            selectedKey = keyItem
                            renderDialog()
                        })

                        keysContainer.appendChild(option)
                    })
                }

                // 渲染推送类型选项
                const actionsContainer = overlay.querySelector('#xtui-picker-actions')
                if (actionsContainer) {
                    const actionOptions = [
                        { action: MENU_ACTIONS.PUSH_ALL, label: '推送全部', desc: '推送所有待办（已完成+未完成）' },
                        { action: MENU_ACTIONS.PUSH_DONE, label: '推送已完成', desc: '仅推送已完成的待办' },
                        { action: MENU_ACTIONS.PUSH_TODO, label: '推送未完成', desc: '仅推送未完成的待办' }
                    ]

                    actionOptions.forEach((item) => {
                        const option = doc.createElement('div')
                        option.className = 'xt-picker-option' + (item.action === selectedAction ? ' selected' : '')

                        const radio = doc.createElement('input')
                        radio.type = 'radio'
                        radio.name = 'xtui-action'
                        radio.checked = item.action === selectedAction

                        const textDiv = doc.createElement('div')
                        textDiv.className = 'xt-picker-option-text'

                        const mainText = doc.createElement('div')
                        mainText.className = 'xt-picker-option-main'
                        mainText.textContent = item.label

                        const subText = doc.createElement('div')
                        subText.className = 'xt-picker-option-sub'
                        subText.textContent = item.desc

                        textDiv.appendChild(mainText)
                        textDiv.appendChild(subText)

                        option.appendChild(radio)
                        option.appendChild(textDiv)

                        option.addEventListener('click', () => {
                            selectedAction = item.action
                            renderDialog()
                        })

                        actionsContainer.appendChild(option)
                    })
                }

                // 绑定按钮事件
                const btnOk = overlay.querySelector('#xtui-picker-ok')
                const btnCancel = overlay.querySelector('#xtui-picker-cancel')

                if (btnOk) {
                    btnOk.addEventListener('click', () => {
                        cleanup({ keyObj: selectedKey, action: selectedAction })
                    })
                }

                if (btnCancel) {
                    btnCancel.addEventListener('click', () => {
                        cleanup(null)
                    })
                }
            }

            const host = doc.body || doc.documentElement
            host.appendChild(overlay)
            renderDialog()

            const cleanup = (result) => {
                try { overlay.remove() } catch {}
                resolve(result)
            }

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) cleanup(null)
            })

            const onKey = (e) => {
                if (e.key === 'Escape') cleanup(null)
            }
            try { doc.addEventListener('keydown', onKey, { once: true }) } catch {}
        } catch {
            resolve(null)
        }
    })
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
                ' <div id="xtui-confirm-head">提示</div>',
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

// 带复选框的确认弹窗，返回 Promise<{confirmed:boolean, checked:boolean}>
function showConfirmWithCheckbox(message, checkboxLabel, defaultChecked = false) {
    return new Promise((resolve) => {
        try {
            const doc = window && window.document ? window.document : null
            if (!doc) throw new Error('NO_DOM')
            ensureConfirmCss()

            const overlay = doc.createElement('div')
            overlay.id = 'xtui-confirm-overlay'
            overlay.innerHTML = [
                '<div id="xtui-confirm-dialog">',
                ' <div id="xtui-confirm-head">提示</div>',
                ' <div id="xtui-confirm-body"></div>',
                ' <div style="padding:12px 14px;border-top:1px solid #e5e7eb;">',
                '   <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#111827;">',
                '     <input id="xtui-confirm-checkbox" type="checkbox" style="margin:0;" />',
                '     <span id="xtui-confirm-checkbox-text"></span>',
                '   </label>',
                ' </div>',
                ' <div id="xtui-confirm-actions">',
                '   <button id="xtui-confirm-cancel">取消</button>',
                '   <button class="primary" id="xtui-confirm-ok">确定</button>',
                ' </div>',
                '</div>'
            ].join('')

            const body = overlay.querySelector('#xtui-confirm-body')
            if (body) body.textContent = String(message || '')

            const cb = overlay.querySelector('#xtui-confirm-checkbox')
            if (cb) cb.checked = !!defaultChecked
            const cbText = overlay.querySelector('#xtui-confirm-checkbox-text')
            if (cbText) cbText.textContent = checkboxLabel || '强制执行'

            const host = doc.body || doc.documentElement
            host.appendChild(overlay)

            const cleanup = (ret) => {
                try { overlay.remove() } catch {}
                resolve(ret)
            }

            const btnOk = overlay.querySelector('#xtui-confirm-ok')
            const btnCancel = overlay.querySelector('#xtui-confirm-cancel')
            if (btnOk) btnOk.addEventListener('click', () => cleanup({ confirmed: true, checked: cb ? cb.checked : false }))
            if (btnCancel) btnCancel.addEventListener('click', () => cleanup({ confirmed: false, checked: cb ? cb.checked : false }))
            overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup({ confirmed: false, checked: cb ? cb.checked : false }) })
            const onKey = (e) => {
                if (e.key === 'Escape') cleanup({ confirmed: false, checked: cb ? cb.checked : false })
                if (e.key === 'Enter') cleanup({ confirmed: true, checked: cb ? cb.checked : false })
            }
            try { doc.addEventListener('keydown', onKey, { once: true }) } catch {}
        } catch {
            resolve({ confirmed: false, checked: false })
        }
    })
}

// 自定义带"不再提示"选项的确认弹窗，返回 Promise<{ confirmed: boolean, dontShowAgain: boolean }>
function showConfirmWithDontShowAgain(message, title = '确认操作') {
    return new Promise((resolve) => {
        try {
            const doc = window && window.document ? window.document : null
            if (!doc) throw new Error('NO_DOM')
            ensureConfirmCss()

            // 分离问题和提示信息
            const parts = String(message || '').split('\n')
            const question = parts[0] || ''
            const info = parts.slice(1).join('\n') || ''

            const overlay = doc.createElement('div')
            overlay.id = 'xtui-confirm-overlay'
            overlay.innerHTML = [
                '<div id="xtui-confirm-dialog">',
                ' <div id="xtui-confirm-head">' + title + '</div>',
                ' <div id="xtui-confirm-body">',
                '   <div style="margin-bottom:12px;font-weight:500;color:#0f172a;">' + question + '</div>',
                info ? '   <div style="padding:10px 12px;background:#f1f5f9;border-radius:6px;font-size:13px;line-height:1.5;color:#475569;">' + info + '</div>' : '',
                ' </div>',
                ' <div style="padding:0 14px 10px;"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="xtui-confirm-dont-show-again" style="width:auto;height:auto;margin:0;">不再提示</label></div>',
                ' <div id="xtui-confirm-actions">',
                '   <button id="xtui-confirm-cancel">取消</button>',
                '   <button class="primary" id="xtui-confirm-ok">确定</button>',
                ' </div>',
                '</div>'
            ].join('')

            const host = doc.body || doc.documentElement
            host.appendChild(overlay)

            const cleanup = (result) => {
                try { overlay.remove() } catch {}
                resolve(result)
            }

            const btnOk = overlay.querySelector('#xtui-confirm-ok')
            const btnCancel = overlay.querySelector('#xtui-confirm-cancel')
            const chkDontShowAgain = overlay.querySelector('#xtui-confirm-dont-show-again')

            if (btnOk) {
                btnOk.addEventListener('click', () => {
                    const dontShowAgain = chkDontShowAgain && chkDontShowAgain.checked
                    cleanup({ confirmed: true, dontShowAgain })
                })
            }

            if (btnCancel) {
                btnCancel.addEventListener('click', () => {
                    const dontShowAgain = chkDontShowAgain && chkDontShowAgain.checked
                    cleanup({ confirmed: false, dontShowAgain })
                })
            }

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    const dontShowAgain = chkDontShowAgain && chkDontShowAgain.checked
                    cleanup({ confirmed: false, dontShowAgain })
                }
            })

            const onKey = (e) => {
                if (e.key === 'Escape') {
                    const dontShowAgain = chkDontShowAgain && chkDontShowAgain.checked
                    cleanup({ confirmed: false, dontShowAgain })
                }
                if (e.key === 'Enter') {
                    const dontShowAgain = chkDontShowAgain && chkDontShowAgain.checked
                    cleanup({ confirmed: true, dontShowAgain })
                }
            }
            try { doc.addEventListener('keydown', onKey, { once: true }) } catch {}
        } catch {
            resolve({ confirmed: false, dontShowAgain: false })
        }
    })
}

// 将选中文本转换为待办事项格式
async function convertSelectedTextToTodo(context, selectedText) {
    try {
        if (!context || !selectedText) return

        // 加载提示状态
        const promptStatus = await loadPromptStatus(context)

        // 如果设置了不再显示提示，则跳过提示直接执行
        if (!promptStatus.showConvertTodoPrompt) {
            performConvertToTodo(context, selectedText)
            return
        }

        // 显示带"不再提示"选项的确认弹窗
        const result = await showConfirmWithDontShowAgain(
            '是否将选中的文本转换为待办事项格式？\n每一行前面将会添加 "- [ ] " 前缀。',
            '转换为待办事项'
        )

        // 如果用户选择了"不再提示"，则保存状态
        if (result.dontShowAgain) {
            await savePromptStatus(context, { showConvertTodoPrompt: false })
        }

        // 如果用户确认转换，则执行转换操作
        if (result.confirmed) {
            performConvertToTodo(context, selectedText)
        }
    } catch (err) {
        log('转换为待办事项时出错', err)
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('转换为待办事项时出错', 'err', 2600)
        }
    }
}

// 执行实际的转换操作
function performConvertToTodo(context, selectedText) {
    try {
        if (!context || !selectedText) return

        // 获取选中文本的每一行
        const lines = selectedText.split(/\r?\n/)

        // 为每一行添加 "- [ ] " 前缀
        const convertedLines = lines.map(line => {
            // 如果行已经是以 "- [ ]" 或 "- [x]" 开头，则不重复添加
            if (/^\s*[-*]\s+\[(\s|x|X)\]/.test(line)) {
                return line
            }
            // 如果行是空行，则保持原样
            if (line.trim() === '') {
                return line
            }
            // 为非空行添加前缀
            return '- [ ] ' + line
        })

        // 重新组合文本
        const convertedText = convertedLines.join('\n')

        // 替换选中的文本
        if (context.replaceSelection) {
            context.replaceSelection(convertedText)
        } else if (window.editor && typeof window.editor.replaceSelection === 'function') {
            window.editor.replaceSelection(convertedText)
        } else {
            // 降级方案：使用 document.execCommand (可能不适用于所有编辑器)
            try {
                document.execCommand('insertText', false, convertedText)
            } catch {
                if (context.ui && context.ui.notice) {
                    context.ui.notice('无法替换选中文本，请手动粘贴以下内容：\n' + convertedText, 'err', 4000)
                }
                return
            }
        }

        if (context.ui && context.ui.notice) {
            context.ui.notice('已将选中文本转换为待办事项格式', 'ok', 2000)
        }
    } catch (err) {
        log('执行转换操作时出错', err)
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('执行转换操作时出错', 'err', 2600)
        }
    }
}

// 自定义API Key缺失提示弹窗，提供打开设置窗口选项
async function showApiKeyMissingDialog(context) {
    return new Promise((resolve) => {
        try {
            const doc = window && window.document ? window.document : null
            if (!doc) throw new Error('NO_DOM')
            ensureConfirmCss()

            const overlay = doc.createElement('div')
            overlay.id = 'xtui-confirm-overlay'
            overlay.innerHTML = [
                '<div id="xtui-confirm-dialog">',
                ' <div id="xtui-confirm-head">提示</div>',
                ' <div id="xtui-confirm-body">您还没有配置API Key，请先配置。</div>',
                ' <div id="xtui-confirm-actions">',
                '   <button id="xtui-confirm-cancel">取消</button>',
                '   <button class="primary" id="xtui-confirm-ok">去配置</button>',
                ' </div>',
                '</div>'
            ].join('')

            const host = doc.body || doc.documentElement
            host.appendChild(overlay)

            const cleanup = (ret) => {
                try { overlay.remove() } catch {}
                resolve(!!ret)
            }

            const btnOk = overlay.querySelector('#xtui-confirm-ok')
            const btnCancel = overlay.querySelector('#xtui-confirm-cancel')

            if (btnOk) {
                btnOk.addEventListener('click', async () => {
                    cleanup(true)
                    // 用户点击"去配置"后打开设置窗口
                    if (typeof context.openSettings === 'function') {
                        await context.openSettings()
                    } else if (typeof openSettings === 'function') {
                        await openSettings(context)
                    }
                })
            }

            if (btnCancel) {
                btnCancel.addEventListener('click', () => cleanup(false))
            }

            overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false) })

            const onKey = (e) => {
                if (e.key === 'Escape') cleanup(false)
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

        // 兼容旧版单 key：如果 apiKeys 为空而 apiKey 存在，则迁移
        if ((!Array.isArray(merged.apiKeys) || !merged.apiKeys.length) && merged.apiKey) {
            merged.apiKeys = [{ key: merged.apiKey, note: '默认', isDefault: true, channel: merged.channel || '' }]
        }

        // 兼容旧版全局 channel：如果存在全局 channel 但默认 Key 没有 channel，则迁移
        if (merged.channel && Array.isArray(merged.apiKeys) && merged.apiKeys.length) {
            const defaultKey = merged.apiKeys.find((k) => k && k.isDefault)
            if (defaultKey && !defaultKey.channel) {
                defaultKey.channel = merged.channel
            }
        }

        // 规整 key 列表并保证唯一默认
        merged.apiKeys = normalizeApiKeys(merged.apiKeys)
        merged.apiKey = merged.apiKeys.length ? merged.apiKeys.find((k) => k.isDefault)?.key || merged.apiKeys[0].key : ''

        log('配置已加载', {
            hasKey: !!merged.apiKey,
            keyCount: merged.apiKeys.length,
            from: merged.from,
            channel: !!merged.channel
        })
        return merged
    } catch {
        return { ...DEFAULT_CFG }
    }
}

// 保存配置
async function saveCfg(context, cfg) {
    try {
        if (!context || !context.storage || !context.storage.set) return
        const normalized = { ...DEFAULT_CFG, ...cfg }
        normalized.apiKeys = normalizeApiKeys(normalized.apiKeys)
        normalized.apiKey = normalized.apiKeys.length
            ? normalized.apiKeys.find((k) => k.isDefault)?.key || normalized.apiKeys[0].key
            : ''
        await context.storage.set(CFG_KEY, normalized)
    } catch {
        // 忽略存储错误
    }
}

// 加载提示状态
async function loadPromptStatus(context) {
    try {
        if (!context || !context.storage || !context.storage.get) return { ...DEFAULT_PROMPT_STATUS }
        const raw = await context.storage.get(PROMPT_STATUS_KEY)
        if (!raw || typeof raw !== 'object') return { ...DEFAULT_PROMPT_STATUS }
        return { ...DEFAULT_PROMPT_STATUS, ...raw }
    } catch {
        return { ...DEFAULT_PROMPT_STATUS }
    }
}

// 保存提示状态
async function savePromptStatus(context, status) {
    try {
        if (!context || !context.storage || !context.storage.set) return
        const normalized = { ...DEFAULT_PROMPT_STATUS, ...status }
        await context.storage.set(PROMPT_STATUS_KEY, normalized)
    } catch {
        // 忽略存储错误
    }
}

// 规范化多密钥，确保最多一个默认，缺省时让第一条为默认
function normalizeApiKeys(list) {
    const arr = Array.isArray(list) ? list : []
    const cleaned = []
    for (const item of arr) {
        if (!item || !item.key) continue
        cleaned.push({
            key: String(item.key).trim(),
            note: item.note ? String(item.note).trim() : '',
            isDefault: !!item.isDefault,
            channel: item.channel ? String(item.channel).trim() : ''
        })
    }
    if (!cleaned.length) return []
    // 确保只有一个默认
    let defaultFound = false
    cleaned.forEach((item) => {
        if (item.isDefault && !defaultFound) {
            defaultFound = true
            item.isDefault = true
        } else {
            item.isDefault = false
        }
    })
    if (!defaultFound) cleaned[0].isDefault = true
    return cleaned
}

// 确保列表中有且仅有一个默认，若空则补空行并设默认
function ensureDefaultKey(list) {
    const arr = Array.isArray(list) ? list.slice() : []
    if (!arr.length) {
        arr.push({ key: '', note: '', isDefault: true, channel: '' })
        return arr
    }
    const hasDefault = arr.some((k) => k && k.isDefault)
    if (!hasDefault) arr[0].isDefault = true
    return arr
}

function pickDefaultKey(cfg) {
    if (!cfg || !Array.isArray(cfg.apiKeys)) return null
    const def = cfg.apiKeys.find((k) => k && k.isDefault)
    if (def) return def
    return cfg.apiKeys[0] || null
}

function describeKey(item) {
    if (!item) return ''
    const key = String(item.key || '')
    const tail = key.length > 8 ? key.slice(-4) : key
    return item.note ? item.note + ' (' + tail + ')' : 'Key ' + tail
}

function escapeRegExp(str) {
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getFlagTexts(cfg) {
    const pushFlag = (cfg && cfg.pushFlag) ? String(cfg.pushFlag).trim() : TODO_FLAG_MAP[TODO_FLAG_PUSHED]
    const remindFlag = (cfg && cfg.remindFlag) ? String(cfg.remindFlag).trim() : TODO_FLAG_MAP[TODO_FLAG_REMINDED]
    return {
        [TODO_FLAG_PUSHED]: pushFlag || TODO_FLAG_MAP[TODO_FLAG_PUSHED],
        [TODO_FLAG_REMINDED]: remindFlag || TODO_FLAG_MAP[TODO_FLAG_REMINDED]
    }
}

// 解析标题末尾的标记，返回纯标题与状态
function parseTitleAndFlags(title, cfg) {
    const res = {
        text: String(title || '').trim(),
        pushed: false,
        reminded: false
    }
    const flags = getFlagTexts(cfg)
    const reg = new RegExp(
        '\\s+(' + escapeRegExp(flags[TODO_FLAG_PUSHED]) + '|' + escapeRegExp(flags[TODO_FLAG_REMINDED]) + ')\\s*$',
        'i'
    )
    let cur = res.text
    let m = reg.exec(cur)
    while (m) {
        const flag = (m[1] || '').toLowerCase()
        if (flag === flags[TODO_FLAG_PUSHED].toLowerCase()) res.pushed = true
        if (flag === flags[TODO_FLAG_REMINDED].toLowerCase()) res.reminded = true
        cur = cur.slice(0, m.index).trimEnd()
        m = reg.exec(cur)
    }
    res.text = cur
    return res
}

// 将行尾标记解析出来并追加新的标记
function addFlagsToLine(line, flagKeys, cfg) {
    const flags = getFlagTexts(cfg)
    const keys = Array.isArray(flagKeys) ? flagKeys.filter(Boolean) : [flagKeys].filter(Boolean)
    if (!keys.length) return line
    let base = String(line || '')
    const reg = new RegExp(
        '\\s+(' + escapeRegExp(flags[TODO_FLAG_PUSHED]) + '|' + escapeRegExp(flags[TODO_FLAG_REMINDED]) + ')\\s*$',
        'i'
    )
    const exist = []
    let m = reg.exec(base)
    while (m) {
        const flagLower = (m[1] || '').toLowerCase()
        if (flagLower === flags[TODO_FLAG_PUSHED].toLowerCase()) exist.unshift(TODO_FLAG_PUSHED)
        else if (flagLower === flags[TODO_FLAG_REMINDED].toLowerCase()) exist.unshift(TODO_FLAG_REMINDED)
        base = base.slice(0, m.index).trimEnd()
        m = reg.exec(base)
    }
    const merged = exist.slice()
    keys.forEach((k) => {
        const key = String(k).toLowerCase()
        if (merged.indexOf(key) < 0) merged.push(key)
    })
    const tail = merged
        .map((k) => flags[k] || TODO_FLAG_MAP[k] || '[' + k + ']')
        .join(' ')
    return tail ? (base.trimEnd() + ' ' + tail) : base
}

// 在文本块中为指定待办行追加标记
function applyFlagsToContent(content, todos, flagKeys, cfg) {
    const lines = String(content || '').split(/\r?\n/)
    const targets = new Set(
        Array.isArray(todos)
            ? todos.map((t) => (t && t.line ? Number(t.line) : 0)).filter(Boolean)
            : []
    )
    if (!targets.size) return content
    for (let i = 0; i < lines.length; i++) {
        const ln = i + 1
        if (!targets.has(ln)) continue
        lines[i] = addFlagsToLine(lines[i], flagKeys, cfg)
    }
    return lines.join('\n')
}

function normalizeTodoKey(todo) {
    if (!todo) return ''
    const title = String(todo.title || '').trim()
    const status = todo.done ? '1' : '0'
    return status + '|' + title
}

// 将标记写回编辑器（优先更新选区，如不支持则回退到全文定位匹配）
function writeBackTodoFlags(context, opts) {
    try {
        if (!context) return
        const { baseContent, useSelection, todos, flagKeys } = opts || {}
        if (!Array.isArray(todos) || !todos.length) return

        // 1) 选区直接替换（最快，不影响全文）
        if (useSelection && baseContent) {
            const nextContent = applyFlagsToContent(baseContent, todos, flagKeys, opts.cfg)
            if (context.replaceSelection) {
                context.replaceSelection(nextContent)
                return
            } else if (window.editor && typeof window.editor.replaceSelection === 'function') {
                window.editor.replaceSelection(nextContent)
                return
            }
        }

        // 2) 选区定位到全文再写回：计算选区在全文中的起始行，精确标记
        const fullContent = context.getEditorValue ? context.getEditorValue() : null
        if (useSelection && baseContent && fullContent) {
            const idx = fullContent.indexOf(baseContent)
            if (idx >= 0) {
                const preLines = idx === 0 ? 0 : fullContent.slice(0, idx).split(/\r?\n/).length - 1
                const shiftedTodos = todos.map((t) => ({
                    ...t,
                    line: (t && t.line ? t.line : 0) + preLines
                }))
                const updated = applyFlagsToContent(fullContent, shiftedTodos, flagKeys, opts.cfg)
                if (context.setEditorValue) {
                    context.setEditorValue(updated)
                    return
                } else if (window.editor && typeof window.editor.setValue === 'function') {
                    window.editor.setValue(updated)
                    return
                }
            }
        }

        // 3) 回退到全文：通过标题+完成状态匹配对应行，避免遗漏
        if (!fullContent) {
            log('缺少 getEditorValue，无法回退写回标记')
            return
        }
        const docTodos = extractTodos(fullContent)
        const docUsed = new Set()
        const matched = []

        for (const todo of todos) {
            const key = normalizeTodoKey(todo)
            const idx = docTodos.findIndex((d, i) => !docUsed.has(i) && normalizeTodoKey(d) === key)
            if (idx >= 0) {
                matched.push(docTodos[idx])
                docUsed.add(idx)
            }
        }

        if (!matched.length) {
            log('未找到可写回的待办行，可能文档已变更')
            return
        }

        const updatedContent = applyFlagsToContent(fullContent, matched, flagKeys, opts.cfg)
        if (context.setEditorValue) {
            context.setEditorValue(updatedContent)
        } else if (window.editor && typeof window.editor.setValue === 'function') {
            window.editor.setValue(updatedContent)
        } else {
            log('缺少 setEditorValue，无法写回全文标记')
        }
    } catch (err) {
        log('写回标记失败', err)
    }
}

// 从文档内容中提取所有待办（识别「- [ ] 文本」/「- [x] 文本」以及 * 列表）
function extractTodos(text, cfg) {
    const src = String(text || '')
    const lines = src.split(/\r?\n/)
    const out = []

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i]
        if (!raw) continue
        const m = raw.match(/^\s*[-*]\s+\[(\s|x|X)\]\s+(.+)$/)
        if (!m) continue
        const parsed = parseTitleAndFlags(m[2], cfg)
        const title = parsed.text
        if (!title) continue
        const marker = String(m[1] || '').trim().toLowerCase()
        out.push({
            title,
            content: raw,
            line: i + 1,
            done: marker === 'x',
            pushed: parsed.pushed,
            reminded: parsed.reminded
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
async function pushInstantBatch(context, cfg, todos, filterLabel, keyObj) {
    const key = keyObj && keyObj.key ? String(keyObj.key).trim() : ''
    if (!key) throw new Error('NO_API_KEY')
    const list = Array.isArray(todos) ? todos.filter(Boolean) : []
    if (!list.length) throw new Error('NO_TODO')

    const label = filterLabel || '全部'
    const url = 'https://www.xxtui.com/xxtui/' + encodeURIComponent(key)
    const lines = []
    lines.push('提醒列表（' + label + '，共 ' + list.length + ' 条）：')
    lines.push('')
    list.forEach((todo, idx) => {
        const text = String(todo && todo.title || '').trim() || '- [ ] 待办事项'
        lines.push((idx + 1) + '. ' + todoStatusTag(todo) + ' ' + text)
    })
    lines.push('')
    lines.push('来源：' + ((cfg && cfg.from) || '飞速MarkDown'))

    const payload = {
        from: (cfg && cfg.from) || '飞速MarkDown',
        title: '[TODO] ' + label + ' · ' + list.length + ' 条',
        content: lines.join('\n'),
        channel: keyObj && keyObj.channel ? String(keyObj.channel) : ''
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
async function pushScheduledTodo(context, cfg, todo, keyObj) {
    const key = keyObj && keyObj.key ? String(keyObj.key).trim() : ''
    if (!key) throw new Error('NO_API_KEY')
    const ts = todo && todo.reminderTime ? Number(todo.reminderTime) : 0
    if (!ts || !Number.isFinite(ts)) throw new Error('BAD_TIME')

    const url = 'https://www.xxtui.com/scheduled/reminder/' + encodeURIComponent(key)
    const text = String(todo && todo.title || '').trim()
    const title = '[TODO] ' + (text || '待办事项')
    const lines = []
    const mainText = (todoStatusTag(todo) + ' ' + (text || '待办事项')).trim()
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

async function runPushFlow(context, cfg, type, keyObj, selectedText) {
    log('开始推送流程', { type, keyObj: keyObj ? 'custom' : 'default' })

    if (!context || !context.getEditorValue) {
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('当前环境不支持读取待办内容', 'err', 2600)
        }
        return
    }

    // 如果提供了选中的文本，则只解析选中的文本；否则解析全文
    const content = selectedText || context.getEditorValue()
    const allTodos = extractTodos(content, cfg)
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
    const pushedMarked = filtered.filter((item) => item && item.pushed)
    const unpushed = filtered.filter((item) => item && !item.pushed)

    const hasMarked = pushedMarked.length > 0
    const hasUnmarked = unpushed.length > 0
    const confirmText =
        '检测到 ' +
        filtered.length +
        ' 条' +
        label +
        '待办。\n' +
        (hasMarked
            ? '其中 ' + pushedMarked.length + ' 条已标记为已推送，默认只推送未标记的。'
            : '未发现已推送标记，将推送全部。')

    const { confirmed, checked } = await showConfirmWithCheckbox(confirmText, '强制推送（包含已标记）', false)
    if (!confirmed) return

    const forcePush = !!checked
    const target = forcePush ? filtered : unpushed

    if (!target.length) {
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('目标待办均已标记，可勾选“强制推送”后发送', 'err', 3200)
        }
        return
    }

    try {
        await pushInstantBatch(context, cfg, target, label, keyObj)
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('xxtui 推送完成：已发送 ' + target.length + ' 条', 'ok', 3600)
        }
        if (cfg.enableWriteback !== false) {
            writeBackTodoFlags(context, {
                baseContent: content,
                useSelection: !!selectedText,
                todos: target,
                flagKeys: [TODO_FLAG_PUSHED],
                cfg
            })
        }
    } catch (err) {
        const msg = err && err.message ? String(err.message) : '推送失败'
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('xxtui 推送失败：' + msg, 'err', 3600)
        }
    }
}

async function runReminderFlow(context, cfg, keyObj, selectedText) {
    log('开始提醒流程', { keyObj: keyObj ? 'custom' : 'default' })

    if (!context || !context.getEditorValue) {
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('当前环境不支持读取待办内容', 'err', 2600)
        }
        return
    }

    // 如果提供了选中的文本，则只解析选中的文本；否则解析全文
    const content = selectedText || context.getEditorValue()
    const allTodos = extractTodos(content, cfg)
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
        await showConfirm('未找到包含有效时间（@...）的未完成待办，无法创建定时提醒')
        return
    }

    const remindedMarked = scheduled.filter((item) => item && item.reminded)
    const unreminded = scheduled.filter((item) => item && !item.reminded)

    const hasMarked = remindedMarked.length > 0
    const hasUnmarked = unreminded.length > 0

    const confirmText =
        '检测到 ' +
        scheduled.length +
        ' 条包含时间的未完成待办。\n' +
        (hasMarked
            ? '其中 ' + remindedMarked.length + ' 条已标记为已创建提醒，默认只创建未标记的。'
            : '未发现已创建标记，将为全部创建提醒。')

    const { confirmed, checked } = await showConfirmWithCheckbox(confirmText, '强制创建提醒（包含已标记）', false)
    if (!confirmed) return

    const forceReminder = !!checked
    const target = forceReminder ? scheduled : unreminded

    if (!target.length) {
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('目标待办均已标记，可勾选“强制创建”后继续', 'err', 3200)
        }
        return
    }

    let okCount = 0
    let failCount = 0
    const successTodos = []
    for (const todo of target) {
        try {
            await pushScheduledTodo(context, cfg, todo, keyObj)
            okCount++
            successTodos.push(todo)
        } catch {
            failCount++
        }
    }

    const msgSchedule = failCount
        ? 'xxtui 定时提醒创建完成：成功 ' + okCount + ' 条，失败 ' + failCount + ' 条'
        : 'xxtui 定时提醒创建完成：成功 ' + okCount + ' 条'
    if (context && context.ui && context.ui.notice) {
        context.ui.notice(msgSchedule, failCount ? 'err' : 'ok', 4000)
    }

    if (successTodos.length && cfg.enableWriteback !== false) {
        writeBackTodoFlags(context, {
            baseContent: content,
            useSelection: !!selectedText,
            todos: successTodos,
            flagKeys: [TODO_FLAG_REMINDED],
            cfg
        })
    }
}

// ========== 插件通信 API（供其他插件调用）==========

/**
 * 推送消息到 xxtui（使用默认 Key）
 * @param {string} title - 标题
 * @param {string} content - 内容
 * @returns {Promise<boolean>} 是否成功
 */
async function pushToXxtui(title, content) {
    try {
        if (!PLUGIN_CONTEXT) throw new Error('Plugin not initialized')

        const cfg = await loadCfg(PLUGIN_CONTEXT)
        const defaultKey = pickDefaultKey(cfg)

        if (!defaultKey || !defaultKey.key) {
            // 统一处理没有API Key的情况，使用自定义弹窗
            if (PLUGIN_CONTEXT) {
                await showApiKeyMissingDialog(PLUGIN_CONTEXT)
            }
            return false
        }

        const url = 'https://www.xxtui.com/xxtui/' + encodeURIComponent(defaultKey.key)
        const payload = {
            from: (cfg && cfg.from) || '飞速MarkDown',
            title: String(title || ''),
            content: String(content || ''),
            channel: defaultKey.channel ? String(defaultKey.channel) : ''
        }

        if (!payload.channel) {
            delete payload.channel
        }

        await PLUGIN_CONTEXT.http.fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })

        log('API推送成功', { title })
        return true
    } catch (err) {
        log('API推送失败', err)
        return false
    }
}

/**
 * 创建定时提醒（使用默认 Key）
 * @param {string} title - 标题
 * @param {string} content - 内容
 * @param {number} reminderTime - 提醒时间（秒级时间戳）
 * @returns {Promise<boolean>} 是否成功
 */
async function createReminder(title, content, reminderTime) {
    try {
        if (!PLUGIN_CONTEXT) throw new Error('Plugin not initialized')

        const cfg = await loadCfg(PLUGIN_CONTEXT)
        const defaultKey = pickDefaultKey(cfg)

        if (!defaultKey || !defaultKey.key) {
            // 统一处理没有API Key的情况，使用自定义弹窗
            if (PLUGIN_CONTEXT) {
                await showApiKeyMissingDialog(PLUGIN_CONTEXT)
            }
            return false
        }

        const ts = Number(reminderTime)
        if (!ts || !Number.isFinite(ts)) {
            throw new Error('Invalid reminderTime')
        }

        const url = 'https://www.xxtui.com/scheduled/reminder/' + encodeURIComponent(defaultKey.key)
        const payload = {
            title: String(title || ''),
            content: String(content || ''),
            reminderTime: ts
        }

        await PLUGIN_CONTEXT.http.fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })

        log('API提醒创建成功', { title, ts })
        return true
    } catch (err) {
        log('API提醒创建失败', err)
        return false
    }
}

/**
 * 解析内容中的待办并批量创建提醒（使用默认 Key）
 * @param {string} content - Markdown 内容
 * @returns {Promise<{success: number, failed: number}>} 成功和失败的数量
 */
async function parseAndCreateReminders(content) {
    try {
        if (!PLUGIN_CONTEXT) throw new Error('Plugin not initialized')

        const cfg = await loadCfg(PLUGIN_CONTEXT)
        const allTodos = extractTodos(content, cfg)
        const pending = allTodos.filter((item) => item && !item.done && !item.reminded)

        if (!pending.length) {
            log('API解析提醒：无未完成待办')
            return { success: 0, failed: 0 }
        }

        const nowSec = Math.floor(Date.now() / 1000)
        const scheduled = []

        for (const todo of pending) {
            const parsed = parseTodoTime(todo.title, nowSec)
            if (!parsed) continue
            scheduled.push({
                title: parsed.title,
                content: todo.content,
                reminderTime: parsed.reminderTime
            })
        }

        log('API解析到提醒待办', scheduled.length)

        if (!scheduled.length) {
            return { success: 0, failed: 0 }
        }

        let success = 0
        let failed = 0

        for (const item of scheduled) {
            const ok = await createReminder(item.title, item.content, item.reminderTime)
            if (ok) {
                success++
            } else {
                failed++
            }
        }

        log('API批量提醒完成', { success, failed })
        return { success, failed }
    } catch (err) {
        log('API解析提醒失败', err)
        return { success: 0, failed: 0 }
    }
}

// ========== 菜单处理函数 ==========

async function handleMenuAction(context, action, keyObj, selectedText) {
    try {
        log('处理菜单动作', action)

        if (!context || !context.http || !context.http.fetch) {
            if (context && context.ui && context.ui.notice) {
                context.ui.notice('当前环境不支持待办推送所需接口', 'err', 2600)
            }
            return
        }

        const cfg = await loadCfg(context)

        // 兼容传入字符串 key 的情况，从配置中查找对应的 keyObj
        let actualKeyObj = keyObj
        if (typeof keyObj === 'string') {
            actualKeyObj = cfg.apiKeys.find((k) => k && k.key === keyObj)
        }
        // 如果没有传入 keyObj，使用默认 Key
        if (!actualKeyObj) {
            actualKeyObj = pickDefaultKey(cfg)
        }

        if (!actualKeyObj || !actualKeyObj.key) {
            // 统一处理没有API Key的情况，使用自定义弹窗
            await showApiKeyMissingDialog(context)
            return
        }

        if (action === MENU_ACTIONS.CREATE_REMINDER) {
            await runReminderFlow(context, cfg, actualKeyObj, selectedText)
            return
        }

        if (
            action === MENU_ACTIONS.PUSH_ALL ||
            action === MENU_ACTIONS.PUSH_DONE ||
            action === MENU_ACTIONS.PUSH_TODO
        ) {
            await runPushFlow(context, cfg, action, actualKeyObj, selectedText)
            return
        }
    } catch (e) {
        const msg = e && e.message ? String(e.message) : String(e || '未知错误')
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('xxtui 待办操作失败：' + msg, 'err', 4000)
        }
        log('处理菜单动作异常', e)
    }
}

// 处理"选择 Key"弹窗选择
async function handlePushWithKeyPicker(context, selectedText) {
    try {
        const cfg = await loadCfg(context)
        const allKeys = cfg.apiKeys || []

        if (!allKeys.length || !allKeys.some(k => k && k.key)) {
            // 统一处理没有API Key的情况，使用自定义弹窗
            await showApiKeyMissingDialog(context)
            return
        }

        const defaultKey = pickDefaultKey(cfg)
        const result = await showKeyPicker(allKeys, defaultKey)
        if (!result || !result.keyObj || !result.action) return

        await handleMenuAction(context, result.action, result.keyObj, selectedText)
    } catch (e) {
        log('选择Key推送失败', e)
    }
}

// 注册右键菜单（支持重新注册以刷新多 Key 列表）
async function registerContextMenus(context) {
    if (!context || !context.addContextMenuItem) return

    // 清理旧的右键菜单
    try {
        while (CTX_MENU_DISPOSERS.length) {
            const d = CTX_MENU_DISPOSERS.pop()
            try { typeof d === 'function' && d() } catch {}
        }
    } catch {}

    // 在三种模式下均显示
    const condition = (ctx) => {
        if (!ctx) return true
        return ctx.mode === 'edit' || ctx.mode === 'preview' || ctx.mode === 'wysiwyg'
    }

    // 加载配置
    const cfg = await loadCfg(context)
    const defaultKey = pickDefaultKey(cfg)

    // 一级：推送到 xxtui（点击直接弹窗选择 Key）
    const pushDisposer = context.addContextMenuItem({
        label: '推送到 xxtui',
        icon: '📤',
        condition,
        onClick: (ctx) => {
            const selectedText = getSelectedMarkdownOrText(context, ctx)
            if (!hasSelectedText(selectedText)) {
                showConfirm('请先选择要推送的文本内容').then(() => {});
                return
            }
            handlePushWithKeyPicker(context, selectedText)
        }
    })

    // 一级：创建提醒（使用默认 Key）
    const reminderDisposer = context.addContextMenuItem({
            label: '创建提醒 (@时间)',
            icon: '⏰',
            condition,
            onClick: (ctx) => {
                if (!hasSelectedText(ctx.selectedText)) {
                    showConfirm('请先选择要创建提醒的文本内容').then(() => {});
                    return
                }
                handleMenuAction(context, MENU_ACTIONS.CREATE_REMINDER, defaultKey, ctx.selectedText)
            }
        })

    // 一级：转换为待办事项
    const convertTodoDisposer = context.addContextMenuItem({
        label: '转换为待办事项',
        icon: '📝',
        condition,
        onClick: (ctx) => {
            if (!hasSelectedText(ctx.selectedText)) {
                showConfirm('请先选择要转换为待办事项的文本内容').then(() => {});
                return
            }
            convertSelectedTextToTodo(context, ctx.selectedText)
        }
    })

    ;[pushDisposer, reminderDisposer, convertTodoDisposer].forEach((d) => {
        if (typeof d === 'function') CTX_MENU_DISPOSERS.push(d)
    })

    log('右键菜单已注册（简化版）')
}

export function activate(context) {
    // 检查必要能力是否存在
    if (!context || !context.getEditorValue || !context.http || !context.http.fetch) {
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('当前环境不支持待办推送所需接口', 'err', 2600)
        }
        return
    }

    // 保存 context 以便后续重新注册菜单
    PLUGIN_CONTEXT = context

    // 顶部菜单
    try { if (REMOVE_TOP_MENU) { REMOVE_TOP_MENU(); REMOVE_TOP_MENU = null } } catch {}
    try {
        REMOVE_TOP_MENU = context.addMenuItem({
            label: '待办',
            title: '推送或创建 xxtui 提醒',
            children: [
                { type: 'group', label: '推送' },
                {
                    label: '全部',
                    note: '含已完成/未完成',
                    onClick: (ctx) => {
                        const selectedText = getSelectedMarkdownOrText(context, ctx)
                        if (!hasSelectedText(selectedText)) {
                            showConfirm('请先选择要推送的文本内容').then(() => {});
                            return
                        }
                        handleMenuAction(context, MENU_ACTIONS.PUSH_ALL, null, selectedText)
                    }
                },
                {
                    label: '已完成',
                    onClick: (ctx) => {
                        const selectedText = getSelectedMarkdownOrText(context, ctx)
                        if (!hasSelectedText(selectedText)) {
                            showConfirm('请先选择要推送的文本内容').then(() => {});
                            return
                        }
                        handleMenuAction(context, MENU_ACTIONS.PUSH_DONE, null, selectedText)
                    }
                },
                {
                    label: '未完成',
                    onClick: (ctx) => {
                        const selectedText = getSelectedMarkdownOrText(context, ctx)
                        if (!hasSelectedText(selectedText)) {
                            showConfirm('请先选择要推送的文本内容').then(() => {});
                            return
                        }
                        handleMenuAction(context, MENU_ACTIONS.PUSH_TODO, null, selectedText)
                    }
                },
                { type: 'divider' },
                { type: 'group', label: '提醒' },
                {
                    label: '创建提醒',
                    note: '@时间',
                    onClick: (ctx) => {
                        const selectedText = getSelectedMarkdownOrText(context, ctx)
                        if (!hasSelectedText(selectedText)) {
                            showConfirm('请先选择要创建提醒的文本内容').then(() => {});
                            return
                        }
                        handleMenuAction(context, MENU_ACTIONS.CREATE_REMINDER, null, selectedText)
                    }
                }
            ]
        })
    } catch {}

    // 右键菜单入口：支持多 Key 动态更新
    registerContextMenus(context).catch((err) => log('右键菜单注册失败', err))

    // 注册插件通信 API，供其他插件调用
    context.registerAPI('xxtui-todo-push', {
        /**
         * 推送消息到 xxtui（使用默认 Key）
         * @param {string} title - 标题
         * @param {string} content - 内容
         * @returns {Promise<boolean>} 是否成功
         */
        pushToXxtui,

        /**
         * 创建定时提醒（使用默认 Key）
         * @param {string} title - 标题
         * @param {string} content - 内容
         * @param {number} reminderTime - 提醒时间（秒级时间戳）
         * @returns {Promise<boolean>} 是否成功
         */
        createReminder,

        /**
         * 解析内容中的待办并批量创建提醒（使用默认 Key）
         * @param {string} content - Markdown 内容
         * @returns {Promise<{success: number, failed: number}>} 成功和失败的数量
         */
        parseAndCreateReminders
    })

    log('插件 API 已注册')
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
            '   <div id="xtui-set-nav">',
            '     <button class="xtui-nav-btn active" data-tab="push">推送设置</button>',
            '     <button class="xtui-nav-btn" data-tab="plugin">插件设置</button>',
            '     <button class="xtui-nav-btn" data-tab="docs">文档</button>',
            '     <button class="xtui-nav-btn" data-tab="api">插件 API</button>',
            '   </div>',
            '   <div id="xtui-set-panel">',
            '     <div class="xtui-tab active" data-tab="push">',
            '       <div class="xt-row"><label>来源 from</label><input id="xtui-set-from" type="text" placeholder="飞速MarkDown"/></div>',
            '       <div class="xt-row" style="flex-direction:column;align-items:stretch;">',
            '         <div class="xt-keys">',
            '           <div class="xt-keys-head">',
            '             <div style="font-weight:600;color:#111827;">API Keys</div>',
            '             <button class="xt-small-btn" id="xtui-add-key">新增 Key</button>',
            '           </div>',
            '           <div class="xt-keys-list" id="xtui-keys-list"></div>',
            '         </div>',
            '       </div>',
            '       <div class="xt-row xt-help">',
            '         <div class="xt-help-title">获取 API Key</div>',
            '         <div class="xt-help-text">',
            '           <div>方式一：扫描下方二维码关注公众号：</div>',
            '           <div style="margin:10px 0;"><img src="https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=gQE_8TwAAAAAAAAAAS5odHRwOi8vd2VpeGluLnFxLmNvbS9xLzAyZC1lUzE3VFVjcEYxMDAwMHcwM1YAAgTE1VdnAwQAAAAA" style="width:150px;height:150px;" alt="公众号二维码"></div>',
            '           <div>在公众号底部菜单点击「更多」→「API_KEY总览」查看所有 Key</div>',
            '           <div style="margin-top:10px;">方式二：<a href="https://www.xxtui.com/apiKey/overview" target="_blank" rel="noopener noreferrer">访问网页获取 API Key</a></div>',
            '           <div style="margin-top:10px;">将获取到的 API Key 填入上方输入框中</div>',
            '         </div>',
            '       </div>',
            '     </div>',
            '     <div class="xtui-tab" data-tab="plugin">',
            '       <div class="xt-row" style="align-items:center;gap:12px;">',
            '         <label style="width:90px;color:#334155;font-size:13px;">是否回写标记</label>',
            '         <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#111827;white-space:nowrap;">',
            '           <input id="xtui-enable-writeback" type="checkbox" style="width:16px;height:16px;"/>',
            '           <span>推送/提醒后写入状态标记</span>',
            '         </label>',
            '       </div>',
            '       <div class="xt-row" style="align-items:center;gap:12px;">',
            '         <label style="width:90px;color:#334155;font-size:13px;">推送标记</label>',
            '         <input id="xtui-flag-push" type="text" style="width:160px;" placeholder="[pushed]" />',
            '       </div>',
            '       <div class="xt-row" style="align-items:center;gap:12px;">',
            '         <label style="width:90px;color:#334155;font-size:13px;">创建提醒标记</label>',
            '         <input id="xtui-flag-remind" type="text" style="width:160px;" placeholder="[reminded]" />',
            '       </div>',
            '       <div class="xt-row" style="align-items:center;gap:12px;padding-top:6px;">',
            '         <label style="width:90px;color:#334155;font-size:13px;">提示设置</label>',
            '         <button class="xt-small-btn" id="xtui-reset-prompt-status">重置转换提示</button>',
            '         <span style="color:#94a3b8;font-size:12px;">恢复“转换为待办”确认弹窗</span>',
            '       </div>',
            '     </div>',
            '     <div class="xtui-tab" data-tab="docs">',
            '       <div class="xt-row xt-help">',
            '         <div class="xt-help-title">用法示例</div>',
            '         <div class="xt-help-text">',
            '           <div>- [ ] 写周报 @2025-11-21 09:00</div>',
            '           <div>- [ ] 开会 @明天 下午3点</div>',
            '           <div>- [ ] 打电话 @2小时后</div>',
            '           <div style="margin-top:4px;">创建提醒仅处理包含 @时间 的未完成待办。</div>',
            '         </div>',
            '       </div>',
            '     </div>',
            '     <div class="xtui-tab" data-tab="api">',
            '       <div class="xt-row xt-help">',
            '         <div class="xt-help-title">插件 API（供其他插件调用）</div>',
            '         <div class="xt-help-text" style="font-size:12px;line-height:1.6;">',
            '           <div style="margin-bottom:6px;font-weight:600;color:#111827;">其他插件可通过以下方式获取并调用本插件 API：</div>',
            '           <code style="display:block;background:#f1f5f9;padding:8px;border-radius:4px;margin-bottom:8px;overflow-x:auto;white-space:pre;">const api = context.getPluginAPI(\'xxtui-todo-push\')</code>',
            '           <div style="margin-top:8px;font-weight:600;color:#111827;">提供的 3 个 API：</div>',
            '           <div style="margin-top:4px;"><strong>1. pushToXxtui(title, content)</strong> - 推送消息</div>',
            '           <div style="margin-left:12px;color:#64748b;">推送到默认 Key，from 取自设置项（默认：飞速MarkDown）</div>',
            '           <div style="margin-top:4px;"><strong>2. createReminder(title, content, reminderTime)</strong> - 创建提醒</div>',
            '           <div style="margin-left:12px;color:#64748b;">reminderTime 为秒级时间戳，使用默认 Key</div>',
            '           <div style="margin-top:4px;"><strong>3. parseAndCreateReminders(content)</strong> - 解析并创建提醒</div>',
            '           <div style="margin-left:12px;color:#64748b;">自动解析 Markdown 内容中的待办（- [ ] 任务 @时间），批量创建提醒</div>',
            '           <div style="margin-left:12px;color:#64748b;">返回：{success: number, failed: number}</div>',
            '         </div>',
            '       </div>',
            '     </div>',
            '   </div>',
            ' </div>',
            ' <div id="xtui-set-actions"><button id="xtui-set-cancel">取消</button><button class="primary" id="xtui-set-ok">保存</button></div>',
            '</div>'
        ].join('')

        const host = doc.body || doc.documentElement
        host.appendChild(overlay)

        // Tab 切换
        const navBtns = overlay.querySelectorAll('.xtui-nav-btn')
        const tabs = overlay.querySelectorAll('.xtui-tab')
        navBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-tab')
                navBtns.forEach((b) => b.classList.toggle('active', b === btn))
                tabs.forEach((p) => p.classList.toggle('active', p.getAttribute('data-tab') === tab))
            })
        })

        const elKeysList = overlay.querySelector('#xtui-keys-list')
        const elAddKey = overlay.querySelector('#xtui-add-key')
        const elFrom = overlay.querySelector('#xtui-set-from')
        const elWriteback = overlay.querySelector('#xtui-enable-writeback')
        const elResetPromptStatus = overlay.querySelector('#xtui-reset-prompt-status')
        const elFlagPush = overlay.querySelector('#xtui-flag-push')
        const elFlagRemind = overlay.querySelector('#xtui-flag-remind')

        let keyList = ensureDefaultKey(cfg.apiKeys)

        const renderKeys = () => {
            if (!elKeysList) return
            elKeysList.innerHTML = ''
            if (!keyList.length) keyList = ensureDefaultKey([])

            keyList.forEach((item, idx) => {
                const wrap = doc.createElement('div')
                wrap.className = 'xt-key-item'

                const inputKey = doc.createElement('input')
                inputKey.type = 'text'
                inputKey.placeholder = 'API Key'
                inputKey.value = item.key || ''
                inputKey.addEventListener('input', (e) => {
                    keyList[idx].key = e.target.value
                })

                const inputNote = doc.createElement('input')
                inputNote.type = 'text'
                inputNote.placeholder = 'Note (Required)'
                inputNote.value = item.note || ''
                inputNote.addEventListener('input', (e) => {
                    keyList[idx].note = e.target.value
                })

                const inputChannel = doc.createElement('input')
                inputChannel.type = 'text'
                inputChannel.placeholder = 'Channel'
                inputChannel.value = item.channel || ''
                inputChannel.addEventListener('input', (e) => {
                    keyList[idx].channel = e.target.value
                })

                const radioWrap = doc.createElement('div')
                radioWrap.className = 'xt-radio'
                const radio = doc.createElement('input')
                radio.type = 'radio'
                radio.name = 'xtui-key-default'
                radio.checked = !!item.isDefault
                radio.addEventListener('change', () => {
                    keyList = keyList.map((k, i) => ({ ...k, isDefault: i === idx }))
                    renderKeys()
                })
                const rLabel = doc.createElement('span')
                rLabel.textContent = '默认'
                radioWrap.appendChild(radio)
                radioWrap.appendChild(rLabel)

                const btnDel = doc.createElement('button')
                btnDel.textContent = '×'
                btnDel.style.width = '28px'
                btnDel.style.height = '28px'
                btnDel.style.display = 'flex'
                btnDel.style.alignItems = 'center'
                btnDel.style.justifyContent = 'center'
                btnDel.style.fontSize = '16px'
                btnDel.style.border = 'none'
                btnDel.style.background = 'transparent'
                btnDel.style.cursor = 'pointer'
                btnDel.addEventListener('click', () => {
                    keyList.splice(idx, 1)
                    keyList = ensureDefaultKey(keyList)
                    renderKeys()
                })

                wrap.appendChild(inputKey)
                wrap.appendChild(inputNote)
                wrap.appendChild(inputChannel)
                wrap.appendChild(radioWrap)
                wrap.appendChild(btnDel)
                elKeysList.appendChild(wrap)
            })
        }

        if (elAddKey) {
            elAddKey.addEventListener('click', () => {
                const needDefault = !keyList.some((k) => k.isDefault)
                keyList.push({ key: '', note: '', channel: '', isDefault: needDefault })
                keyList = ensureDefaultKey(keyList)
                renderKeys()
            })
        }

        // 重置提示状态按钮事件处理
        if (elResetPromptStatus) {
            elResetPromptStatus.addEventListener('click', async () => {
                try {
                    await savePromptStatus(context, { showConvertTodoPrompt: true })
                    if (context.ui && context.ui.notice) {
                        context.ui.notice('提示状态已重置，下次转换时将重新显示提示', 'ok', 2000)
                    }
                } catch (err) {
                    if (context.ui && context.ui.notice) {
                        context.ui.notice('重置提示状态失败', 'err', 2600)
                    }
                }
            })
        }

        renderKeys()

        if (elFrom) elFrom.value = cfg.from || '飞速MarkDown'
        if (elWriteback) elWriteback.checked = cfg.enableWriteback !== false
        if (elFlagPush) elFlagPush.value = (cfg.pushFlag || '[pushed]')
        if (elFlagRemind) elFlagRemind.value = (cfg.remindFlag || '[reminded]')

        const syncFlagInputs = () => {
            const enabled = !elWriteback || !!elWriteback.checked
            const opacity = enabled ? '1' : '0.5'
            if (elFlagPush) {
                elFlagPush.disabled = !enabled
                elFlagPush.style.opacity = opacity
            }
            if (elFlagRemind) {
                elFlagRemind.disabled = !enabled
                elFlagRemind.style.opacity = opacity
            }
        }
        syncFlagInputs()
        if (elWriteback) {
            elWriteback.addEventListener('change', syncFlagInputs)
        }

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
                // 验证：每个有效的 Key 必须有备注
                const hasInvalidKey = keyList.some((item) => {
                    const key = item && item.key ? String(item.key).trim() : ''
                    const note = item && item.note ? String(item.note).trim() : ''
                    return key && !note // 有 Key 但没有备注
                })

                if (hasInvalidKey) {
                    if (context.ui && context.ui.notice) {
                        context.ui.notice('请为每个 API Key 填写备注（必填）', 'err', 3000)
                    }
                    return
                }

                const apiKeys = normalizeApiKeys(keyList)
                const from = elFrom ? String(elFrom.value || '').trim() || '飞速MarkDown' : '飞速MarkDown'
                const enableWriteback = elWriteback ? !!elWriteback.checked : true
                const pushFlag = elFlagPush ? String(elFlagPush.value || '').trim() || '[pushed]' : '[pushed]'
                const remindFlag = elFlagRemind ? String(elFlagRemind.value || '').trim() || '[reminded]' : '[reminded]'

                const nextCfg = {
                    apiKeys,
                    from,
                    enableWriteback,
                    pushFlag,
                    remindFlag
                }

                await saveCfg(context, nextCfg)

                // 重新注册右键菜单以刷新多 Key 列表
                if (PLUGIN_CONTEXT) {
                    registerContextMenus(PLUGIN_CONTEXT).catch((err) => log('重新注册菜单失败', err))
                }

                if (context.ui && context.ui.notice) {
                    context.ui.notice('xxtui 配置已保存', 'ok', 2000)
                }
                close()
            })
        }
    } catch (e) {
        if (context && context.ui && context.ui.notice) {
            context.ui.notice('xxtui 配置保存失败', 'err', 2600)
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
    removeElById('xtui-picker-style')
    removeElById('xtui-set-overlay')
    removeElById('xtui-confirm-overlay')
    removeElById('xtui-picker-overlay')
}
