/*
  flymd 主入口（中文注释）
  - 极简编辑器：<textarea>
  - Ctrl+E 切换编辑/预览
  - Ctrl+O 打开、Ctrl+S 保存、Ctrl+Shift+S 另存为、Ctrl+N 新建
  - 拖放文件打开
*/

import './style.css'

import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

// Tauri 插件（v2）
import { open, save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import { open as openFileHandle, BaseDirectory } from '@tauri-apps/plugin-fs'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { convertFileSrc } from '@tauri-apps/api/core'
import pkg from '../package.json'

type Mode = 'edit' | 'preview'

// 最近文件最多条数
const RECENT_MAX = 5

// 渲染器（延迟初始化，首次进入预览时创建）
let md: MarkdownIt | null = null
let hljsLoaded = false

// 应用状态
let mode: Mode = 'edit'
let currentFilePath: string | null = null
let dirty = false // 是否有未保存更改

// 配置存储（使用 tauri store）
let store: Store | null = null

// 日志相关
const LOG_NAME = 'flymd.log'

// 日志级别
type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

async function appendLog(level: LogLevel, message: string, details?: unknown) {
  const timestamp = new Date().toISOString()
  let logLine = `[${timestamp}] [${level}] ${message}`

  if (details !== undefined) {
    if (details instanceof Error) {
      logLine += `\n  错误: ${details.message}`
      if (details.stack) {
        logLine += `\n  堆栈:\n${details.stack.split('\n').map(l => '    ' + l).join('\n')}`
      }
    } else {
      try {
        logLine += `\n  详情: ${JSON.stringify(details, null, 2)}`
      } catch {
        logLine += `\n  详情: ${String(details)}`
      }
    }
  }

  logLine += '\n'

  // 先输出到控制台作为备份
  const consoleMsg = `[${level}] ${message}`
  if (level === 'ERROR') {
    console.error(consoleMsg, details)
  } else if (level === 'WARN') {
    console.warn(consoleMsg, details)
  } else {
    console.log(consoleMsg, details)
  }

  // 尝试写入文件
  try {
    const data = new TextEncoder().encode(logLine)

    const tryWrite = async (baseDir: BaseDirectory) => {
      try {
        const f = await openFileHandle(LOG_NAME, { write: true, append: true, create: true, baseDir })
        try {
          await f.write(data)
        } finally {
          await f.close()
        }
        return true
      } catch (e) {
        return false
      }
    }

    // 优先尝试写入可执行文件同级目录
    let success = await tryWrite(BaseDirectory.Executable)

    if (!success) {
      // 备选：AppData 或 AppLog
      // @ts-ignore
      success = await tryWrite((BaseDirectory as any).AppLog ?? BaseDirectory.AppData)
    }
  } catch (e) {
    // 文件写入失败也不影响应用运行
    console.warn('日志文件写入失败，但不影响应用运行')
  }
}

// 添加通用日志函数供其他地方调用
function logInfo(message: string, details?: unknown) {
  void appendLog('INFO', message, details)
}

function logWarn(message: string, details?: unknown) {
  void appendLog('WARN', message, details)
}

function logDebug(message: string, details?: unknown) {
  void appendLog('DEBUG', message, details)
}

// 将任意 open() 返回值归一化为可用于 fs API 的字符串路径
function normalizePath(input: unknown): string {
  try {
    if (typeof input === 'string') return input
    if (input && typeof (input as any).path === 'string') return (input as any).path
    if (input && typeof (input as any).filePath === 'string') return (input as any).filePath
    const p: any = (input as any)?.path
    if (p) {
      if (typeof p === 'string') return p
      if (typeof p?.href === 'string') return p.href
      if (typeof p?.toString === 'function') {
        const s = p.toString()
        if (typeof s === 'string' && s) return s
      }
    }
    if (input && typeof (input as any).href === 'string') return (input as any).href
    if (input && typeof (input as any).toString === 'function') {
      const s = (input as any).toString()
      if (typeof s === 'string' && s) return s
    }
    return String(input ?? '')
  } catch {
    return String(input ?? '')
  }
}

function showError(msg: string, err?: unknown) {
  void appendLog('ERROR', msg, err)
  // 确保 status 元素存在后才更新
  const statusEl = document.getElementById('status')
  if (statusEl) {
    statusEl.textContent = `错误: ${msg}`
  } else {
    console.error('错误:', msg, err)
  }
  ;(() => {
    try {
      const statusEl2 = document.getElementById('status')
      if (statusEl2) {
        let __text = `错误: ${msg}`
        try {
          const __detail = (err instanceof Error)
            ? err.message
            : (typeof err === 'string' ? err : (err ? JSON.stringify(err) : ''))
          if (__detail) __text += ` - ${__detail}`
        } catch {}
        statusEl2.textContent = __text
      }
    } catch {}
  })()
}

function guard<T extends (...args: any[]) => any>(fn: T) {
  return (...args: Parameters<T>) => {
    try {
      const r = fn(...args)
      if (r && typeof (r as any).then === 'function') {
        ;(r as Promise<any>).catch((e) => showError('处理事件失败', e))
      }
    } catch (e) {
      showError('处理事件异常', e)
    }
  }
}

// UI 结构搭建
const app = document.getElementById('app')!
app.innerHTML = `
  <div class="titlebar">
    <div class="menubar">
      <div class="menu-item" id="btn-open" title="打开 (Ctrl+O)">文件</div>
      <div class="menu-item" id="btn-save" title="保存 (Ctrl+S)">保存</div>
      <div class="menu-item" id="btn-saveas" title="另存为 (Ctrl+Shift+S)">另存为</div>
      <div class="menu-item" id="btn-toggle" title="编辑/预览 (Ctrl+E)">预览</div>
      <div class="menu-item" id="btn-new" title="新建 (Ctrl+N)">新建</div>
    </div>
    <div class="filename" id="filename">未命名</div>
  </div>
  <div class="container">
    <textarea id="editor" class="editor" spellcheck="false" placeholder="在此输入 Markdown 文本……"></textarea>
    <div id="preview" class="preview hidden"></div>
    <div class="statusbar" id="status">行 1, 列 1</div>
  </div>
`

const editor = document.getElementById('editor') as HTMLTextAreaElement
const preview = document.getElementById('preview') as HTMLDivElement
const filenameLabel = document.getElementById('filename') as HTMLDivElement
const status = document.getElementById('status') as HTMLDivElement

// 动态添加"最近文件"菜单项
const menubar = document.querySelector('.menubar') as HTMLDivElement
if (menubar) {
  const recentBtn = document.createElement('div')
  recentBtn.id = 'btn-recent'
  recentBtn.className = 'menu-item'
  recentBtn.title = '最近文件'
  recentBtn.textContent = '最近'
  menubar.appendChild(recentBtn)
  const aboutBtn = document.createElement('div')
  aboutBtn.id = 'btn-about'
  aboutBtn.className = 'menu-item'
  aboutBtn.title = '关于'
  aboutBtn.textContent = '关于'
  menubar.appendChild(aboutBtn)
}
const containerEl = document.querySelector('.container') as HTMLDivElement
if (containerEl) {
  const panel = document.createElement('div')
  panel.id = 'recent-panel'
  panel.className = 'recent-panel hidden'
  containerEl.appendChild(panel)

  // 关于弹窗（初始隐藏）
  const about = document.createElement('div')
  about.id = 'about-overlay'
  about.className = 'about-overlay hidden'
  about.innerHTML = `
    <div class="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
      <div class="about-header">
        <div id="about-title">关于 flyMD</div>
        <button id="about-close" class="about-close" title="关闭">✕</button>
      </div>
      <div class="about-body">
        <p>一款多平台的极致简洁、即开即用的 Markdown 文档编辑预览工具。</p>

        <div class="about-subtitle">快捷键</div>
        <div class="about-shortcuts">
          <div class="sc-act">打开文件</div><div class="sc-keys"><kbd>Ctrl</kbd> + <kbd>O</kbd></div>
          <div class="sc-act">保存</div><div class="sc-keys"><kbd>Ctrl</kbd> + <kbd>S</kbd></div>
          <div class="sc-act">另存为</div><div class="sc-keys"><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd></div>
          <div class="sc-act">新建</div><div class="sc-keys"><kbd>Ctrl</kbd> + <kbd>N</kbd></div>
          <div class="sc-act">编辑/预览</div><div class="sc-keys"><kbd>Ctrl</kbd> + <kbd>E</kbd></div>
          <div class="sc-act">退出预览/关闭关于</div><div class="sc-keys"><kbd>Esc</kbd></div>
        </div>
        <div class="about-links">
          <p>作者网站：<a href="https://www.llingfei.com" target="_blank" rel="noopener noreferrer">https://www.llingfei.com</a></p>
          <p>GitHub 地址：<a href="https://github.com/flyhunterl/flymd" target="_blank" rel="noopener noreferrer">https://github.com/flyhunterl/flymd</a></p>
        </div>
      </div>
    </div>
  `
  containerEl.appendChild(about)
  // 在关于对话框底部右侧添加版本信息
  try {
    const overlay = document.getElementById('about-overlay') as HTMLDivElement | null
    const dialog = overlay?.querySelector('.about-dialog') as HTMLDivElement | null
    if (dialog) {
      const footer = document.createElement('div')
      footer.className = 'about-footer'
      footer.innerHTML = '<div class="about-footer-links">\
<a href="https://www.llingfei.com" target="_blank" rel="noopener noreferrer">\
  <img class="favicon" src="https://icons.duckduckgo.com/ip3/www.llingfei.com.ico" alt="" referrerpolicy="no-referrer"/>作者博客\
</a><span class="sep">·</span>\
<a href="https://github.com/flyhunterl/flymd" target="_blank" rel="noopener noreferrer">\
  <img class="favicon" src="https://icons.duckduckgo.com/ip3/github.com.ico" alt="" referrerpolicy="no-referrer"/>GitHub 地址\
</a></div><span id="about-version"></span>'
      dialog.appendChild(footer)
      const verEl = footer.querySelector('#about-version') as HTMLSpanElement | null
      const version = (pkg as any)?.version ?? '0.0.0'
      if (verEl) verEl.textContent = `v${version}`
    }
  } catch {}
}

// 初始化存储
async function initStore() {
  try {
    console.log('初始化应用存储...')
    // Tauri v2：使用 Store.load 并由后端在 app_data_dir 下持久化
    store = await Store.load('flymd-settings.json')
    console.log('存储初始化成功')
    // 存储初始化后才记录日志
    void logInfo('应用存储初始化成功')
    return true
  } catch (error) {
    console.error('存储初始化失败:', error)
    console.warn('将以无持久化模式运行（浏览器模式或 Tauri 未就绪）')
    void logWarn('存储初始化失败，以内存模式运行', error)
    // 不抛出错误，允许应用继续运行
    return false
  }
}

// 更新标题和未保存标记
function refreshTitle() {
  const name = currentFilePath ? currentFilePath.split(/[/\\]/).pop() : '未命名'
  filenameLabel.textContent = name + (dirty ? ' *' : '')
  document.title = `flymd - ${name}${dirty ? ' *' : ''}`
}

// 更新状态栏（行列）
function refreshStatus() {
  const pos = editor.selectionStart
  const until = editor.value.slice(0, pos)
  const lines = until.split(/\n/)
  const row = lines.length
  const col = (lines[lines.length - 1] || '').length + 1
  status.textContent = `行 ${row}, 列 ${col}`
}

// 延迟加载高亮库并创建 markdown-it
async function ensureRenderer() {
  if (md) return
  if (!hljsLoaded) {
    // 按需加载 highlight.js
    const hljs = await import('highlight.js')
    hljsLoaded = true
    md = new MarkdownIt({
      html: false,
      linkify: true,
      highlight(code, lang) {
        try {
          if (lang && hljs.default.getLanguage(lang)) {
            const r = hljs.default.highlight(code, { language: lang, ignoreIllegals: true })
            return `<pre><code class="hljs language-${lang}">${r.value}</code></pre>`
          }
        } catch {}
        const esc = code.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]!))
        return `<pre><code class="hljs">${esc}</code></pre>`
      }
    })
  }
}

// 渲染预览（带安全消毒）
async function renderPreview() {
  await ensureRenderer()
  const raw = editor.value
  const safe = DOMPurify.sanitize(raw)
  const html = md!.render(safe)
  preview.innerHTML = html
  // 外链安全属性
  preview.querySelectorAll('a[href]').forEach((a) => {
    const el = a as HTMLAnchorElement
    el.target = '_blank'
    el.rel = 'noopener noreferrer'
  })
  // 处理本地图片路径为 asset: URL，确保在 Tauri 中可显示
  try {
    const base = currentFilePath ? currentFilePath.replace(/[\\/][^\\/]*$/, '') : null
    preview.querySelectorAll('img[src]').forEach((img) => {
      try {
        const el = img as HTMLImageElement
        const src = el.getAttribute('src') || ''
        if (!src) return
        // 跳过已可用的协议
        if (/^(data:|blob:|asset:|https?:)/i.test(src)) return
        if (!base) return
        let abs: string
        if (/^[a-zA-Z]:\\|^\\\\|^\//.test(src)) {
          abs = src
        } else {
          const sep = base.includes('\\') ? '\\' : '/'
          const parts = (base + sep + src).split(/[\\/]+/)
          const stack: string[] = []
          for (const p of parts) {
            if (!p || p === '.') continue
            if (p === '..') { stack.pop(); continue }
            stack.push(p)
          }
          abs = base.includes('\\') ? stack.join('\\') : '/' + stack.join('/')
        }
        const url = typeof convertFileSrc === 'function' ? convertFileSrc(abs) : abs
        el.src = url
      } catch {}
    })
  } catch {}
}

// 拖拽支持：
function extIsImage(name: string): boolean {
  return /\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i.test(name)
}

function insertAtCursor(text: string) {
  const start = editor.selectionStart
  const end = editor.selectionEnd
  const val = editor.value
  editor.value = val.slice(0, start) + text + val.slice(end)
  const pos = start + text.length
  editor.selectionStart = editor.selectionEnd = pos
  dirty = true
  refreshTitle()
  refreshStatus()
}

async function fileToDataUrl(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  const b64 = btoa(bin)
  const mime = file.type || 'application/octet-stream'
  return `data:${mime};base64,${b64}`
}

// 切换模式
async function toggleMode() {
  mode = mode === 'edit' ? 'preview' : 'edit'
  if (mode === 'preview') {
    await renderPreview()
    preview.classList.remove('hidden')
  } else {
    preview.classList.add('hidden')
    editor.focus()
  }
  ;(document.getElementById('btn-toggle') as HTMLButtonElement).textContent = mode === 'edit' ? '预览' : '编辑'
}

// 打开文件
async function openFile(preset?: string) {
  try {
    if (!preset && dirty) {
      const confirmed = confirm('当前文件尚未保存，是否放弃更改并继续打开？')
      if (!confirmed) {
        logDebug('用户取消打开文件操作（未保存）')
        return
      }
    }

    if (!preset) {
      // 检查 Tauri API 是否可用
      if (typeof open !== 'function') {
        alert('文件打开功能需要在 Tauri 应用中使用')
        return
      }
    }

    const selected = preset ?? (await open({ multiple: false, filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }] }))
    if (!selected || Array.isArray(selected)) return

    const selectedPath = (typeof selected === 'string')
      ? selected
      : ((selected as any)?.path ?? (selected as any)?.filePath ?? String(selected))






    logInfo('���ļ�', { path: selectedPath })
    const content = await readTextFile(selectedPath)
    editor.value = content
    currentFilePath = selectedPath
    dirty = false
    refreshTitle()
    refreshStatus()
    await pushRecent(currentFilePath)
    await renderRecentPanel(false)
    logInfo('�ļ����سɹ�', { path: selectedPath, size: content.length })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('invoke') || msg.includes('Tauri')) {
      alert('此功能需要在 Tauri 桌面应用中使用\n当前运行在浏览器环境')
    }
    showError('打开文件失败', error)
  }
}

// 全新的文件打开实现（避免历史遗留的路径处理问题）
async function openFile2(preset?: unknown) {
  try {
    // 如果是事件对象（点击/键盘），忽略它，相当于未传入预设路径
    if (preset && typeof preset === 'object') {
      const evt = preset as any
      if ('isTrusted' in evt || 'target' in evt || typeof evt?.preventDefault === 'function') {
        preset = undefined
      }
    }

    if (!preset && dirty) {
      const confirmed = confirm('当前文件尚未保存，是否放弃更改并继续打开？')
      if (!confirmed) {
        logDebug('用户取消打开文件操作（未保存）')
        return
      }
    }

    if (!preset) {
      if (typeof open !== 'function') {
        alert('文件打开功能需要在 Tauri 应用中使用')
        return
      }
    }

    const selected = (typeof preset === 'string')
      ? preset
      : (await open({ multiple: false, filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }] }))
    if (!selected || Array.isArray(selected)) return

    const selectedPath = normalizePath(selected)
    logDebug('openFile2.selected', { typeof: typeof selected, selected })
    logDebug('openFile2.normalizedPath', { typeof: typeof selectedPath, selectedPath })

    const content = await readTextFile(selectedPath)
    editor.value = content
    currentFilePath = selectedPath
    dirty = false
    refreshTitle()
    refreshStatus()
    if (mode === 'preview') {
      await renderPreview()
    }
    await pushRecent(currentFilePath)
    await renderRecentPanel(false)
    logInfo('文件打开成功', { path: selectedPath, size: content.length })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('invoke') || msg.includes('Tauri')) {
      alert('此功能需要在 Tauri 桌面应用中使用\n当前运行在浏览器环境')
    }
    showError('打开文件失败', error)
  }
}

// 保存文件
async function saveFile() {
  try {
    if (!currentFilePath) {
      await saveAs()
      return
    }

    // 检查 Tauri API
    if (typeof writeTextFile !== 'function') {
      alert('文件保存功能需要在 Tauri 应用中使用')
      return
    }

    logInfo('保存文件', { path: currentFilePath })
    await writeTextFile(currentFilePath, editor.value)
    dirty = false
    refreshTitle()
    await pushRecent(currentFilePath)
    await renderRecentPanel(false)
    logInfo('文件保存成功', { path: currentFilePath, size: editor.value.length })
    status.textContent = '文件已保存'
    setTimeout(() => refreshStatus(), 2000)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('invoke') || msg.includes('Tauri')) {
      alert('此功能需要在 Tauri 桌面应用中使用\n当前运行在浏览器环境')
    }
    showError('保存文件失败', error)
  }
}

// 另存为
async function saveAs() {
  try {
    // 检查 Tauri API
    if (typeof save !== 'function') {
      alert('文件保存功能需要在 Tauri 应用中使用')
      return
    }

    const target = await save({ filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }] })
    if (!target) {
      logDebug('用户取消另存为操作')
      return
    }
    logInfo('另存为文件', { path: target })
    await writeTextFile(target, editor.value)
    currentFilePath = target
    dirty = false
    refreshTitle()
    await pushRecent(currentFilePath)
    await renderRecentPanel(false)
    logInfo('文件另存为成功', { path: target, size: editor.value.length })
    status.textContent = '文件已保存'
    setTimeout(() => refreshStatus(), 2000)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('invoke') || msg.includes('Tauri')) {
      alert('此功能需要在 Tauri 桌面应用中使用\n当前运行在浏览器环境')
    }
    showError('另存为失败', error)
  }
}

// 新建
async function newFile() {
  if (dirty) {
    const confirmed = confirm('当前文件尚未保存，是否放弃更改并新建？')
    if (!confirmed) return
  }
  editor.value = ''
  currentFilePath = null
  dirty = false
  refreshTitle()
  refreshStatus()
  if (mode === 'preview') {
    await renderPreview()
  }
}

// 最近文件管理
async function getRecent(): Promise<string[]> {
  if (!store) return []
  try {
    const value = (await store.get('recent')) as string[] | undefined
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

async function pushRecent(path: string) {
  if (!store) return
  try {
    const list = await getRecent()
    const filtered = [path, ...list.filter((p) => p !== path)].slice(0, RECENT_MAX)
    await store.set('recent', filtered)
    await store.save()
  } catch (e) {
    console.warn('保存最近文件失败:', e)
  }
}

// 渲染/切换 最近文件 面板
async function renderRecentPanel(toggle = true) {
  const panel = document.getElementById('recent-panel') as HTMLDivElement
  if (!panel) return
  const recents = await getRecent()
  if (recents.length === 0) {
    panel.innerHTML = '<div class="empty">暂时没有最近文件</div>'
  } else {
    panel.innerHTML = recents
      .map(
        (p, idx) =>
          `<div class=\"item\" data-path=\"${p.replace(/\"/g, '&quot;')}\">` +
          `${idx + 1}. ${p.split(/[/\\\\]/).pop()}` +
          `<div class=\"path\">${p}</div>` +
          `</div>`
      )
      .join('')
  }
  // 绑定点击
  panel.querySelectorAll('.item').forEach((el) => {
    el.addEventListener('click', async () => {
      const p = (el as HTMLDivElement).dataset.path!
      await openFile2(p)
      panel.classList.add('hidden')
    })
  })
  if (toggle) panel.classList.toggle('hidden')
}

// 绑定事件


// 显示/隐藏 关于 弹窗
function showAbout(show: boolean) {
  const overlay = document.getElementById('about-overlay') as HTMLDivElement | null
  if (!overlay) return
  if (show) overlay.classList.remove('hidden')
  else overlay.classList.add('hidden')
}

function bindEvents() {
  // 全局错误捕获
  window.addEventListener('error', (e) => {
    // @ts-ignore
    showError(e.message || '未捕获错误', (e as any)?.error)
  })
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const reason = (e?.reason instanceof Error) ? e.reason : new Error(String(e?.reason ?? '未知拒绝'))
    showError('未处理的 Promise 拒绝', reason)
  })

  // 菜单项点击事件
  const btnOpen = document.getElementById('btn-open')
  const btnSave = document.getElementById('btn-save')
  const btnSaveas = document.getElementById('btn-saveas')
  const btnToggle = document.getElementById('btn-toggle')
  const btnNew = document.getElementById('btn-new')
  const btnRecent = document.getElementById('btn-recent')
  const btnAbout = document.getElementById('btn-about')

  if (btnOpen) btnOpen.addEventListener('click', guard(() => openFile2()))
  if (btnSave) btnSave.addEventListener('click', guard(() => saveFile()))
  if (btnSaveas) btnSaveas.addEventListener('click', guard(() => saveAs()))
  if (btnToggle) btnToggle.addEventListener('click', guard(() => toggleMode()))
  if (btnNew) btnNew.addEventListener('click', guard(() => newFile()))
  if (btnRecent) btnRecent.addEventListener('click', guard(() => renderRecentPanel(true)))
  if (btnAbout) btnAbout.addEventListener('click', guard(() => showAbout(true)))

  // 文本变化
  editor.addEventListener('input', () => {
    dirty = true
    refreshTitle()
  })
  editor.addEventListener('keyup', refreshStatus)
  editor.addEventListener('click', refreshStatus)
  // 拖拽到编辑器：插入图片（本地文件或 URL）
  editor.addEventListener('dragover', (e) => { e.preventDefault() })
  editor.addEventListener('drop', async (e) => {
    try {
      e.preventDefault()
      const dt = e.dataTransfer
      if (!dt) return
      const files = Array.from(dt.files || [])
      if (files.length > 0) {
        const parts: string[] = []
        for (const f of files) {
          if (extIsImage(f.name) || (f.type && f.type.startsWith('image/'))) {
            const url = await fileToDataUrl(f)
            parts.push(`![${f.name}](${url})`)
          }
        }
        if (parts.length > 0) {
          insertAtCursor(parts.join('\n'))
          if (mode === 'preview') await renderPreview()
        }
        return
      }
      const uriList = dt.getData('text/uri-list') || ''
      const plain = dt.getData('text/plain') || ''
      const cand = (uriList.split('\n').find((l) => /^https?:/i.test(l)) || '').trim() || plain.trim()
      if (cand && /^https?:/i.test(cand)) {
        const isImg = extIsImage(cand)
        insertAtCursor(`${isImg ? '!' : ''}[${isImg ? 'image' : 'link'}](${cand})`)
        if (mode === 'preview') await renderPreview()
      }
    } catch (err) {
      showError('拖拽处理失败', err)
    }
  })

  // 快捷键
  window.addEventListener('keydown', (e) => {
    const aboutOverlay = document.getElementById('about-overlay') as HTMLDivElement | null
    if (e.key === 'Escape' && aboutOverlay && !aboutOverlay.classList.contains('hidden')) { e.preventDefault(); showAbout(false); return }
    if (e.ctrlKey && e.key.toLowerCase() === 'e') { e.preventDefault(); guard(toggleMode)(); return }
    if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); guard(openFile2)(); return }
    if (e.ctrlKey && e.key.toLowerCase() === 's' && !e.shiftKey) { e.preventDefault(); guard(saveFile)(); return }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); guard(saveAs)(); return }
    if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); guard(newFile)(); return }
    if (e.key === 'Escape' && mode === 'preview') { e.preventDefault(); guard(toggleMode)(); return }
  })

  // 关闭前确认（未保存）
  try {
    getCurrentWindow().onCloseRequested((event) => {
      if (dirty) {
        const leave = confirm('当前文件尚未保存，确认退出吗？')
        if (!leave) {
          event.preventDefault()
        }
      }
    })
  } catch (e) {
    console.log('窗口关闭监听注册失败（浏览器模式）')
  }

  // 点击外部区域时关闭最近文件面板
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('recent-panel') as HTMLDivElement
    if (!panel || panel.classList.contains('hidden')) return
    const btn = document.getElementById('btn-recent')
    if (btn && !panel.contains(e.target as Node) && e.target !== btn) {
      panel.classList.add('hidden')
    }
  })

  // 关于弹窗：点击遮罩或“关闭”按钮关闭
  const overlay = document.getElementById('about-overlay') as HTMLDivElement | null
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) showAbout(false)
    })
    const closeBtn = document.getElementById('about-close') as HTMLButtonElement | null
    if (closeBtn) closeBtn.addEventListener('click', () => showAbout(false))
  }

  // 监听 Tauri 文件拖放（用于直接打开 .md/.markdown/.txt 文件）
  ;(async () => {
    try {
      const mod = await import('@tauri-apps/api/event')
      if (typeof mod.listen === 'function') {
        await mod.listen('tauri://file-drop', (ev: any) => {
          try {
            const payload = ev?.payload ?? ev
            const arr = Array.isArray(payload) ? payload : (payload?.paths || payload?.urls || payload?.files || [])
            const paths: string[] = (Array.isArray(arr) ? arr : []).map((p) => normalizePath(p))
            const target = paths.find((p) => /\.(md|markdown|txt)$/i.test(p))
            if (target) void openFile2(target)
          } catch (err) {
            showError('文件拖放事件处理失败', err)
          }
        })
      }
    } catch {
      // 非 Tauri 环境或事件 API 不可用，忽略
    }
  })()
}

// 启动
(async () => {
  try {
    console.log('flyMD 应用启动...')

    // 尝试初始化存储（失败不影响启动）
    await initStore()

    // 核心功能：必须执行
    refreshTitle()
    refreshStatus()
    bindEvents()  // 🔧 关键：无论存储是否成功，都要绑定事件

    // 尝试加载最近文件（可能失败）
    try {
      await renderRecentPanel(false)
    } catch (e) {
      console.warn('最近文件面板加载失败:', e)
    }

    setTimeout(() => editor.focus(), 0)
    console.log('应用初始化完成')
    void logInfo('flyMD 应用初始化完成')
  } catch (error) {
    console.error('应用启动失败:', error)
    showError('应用启动失败', error)

    // 🔧 即使启动失败，也尝试绑定基本事件
    try {
      bindEvents()
      console.log('已降级绑定基本事件')
    } catch (e) {
      console.error('事件绑定也失败了:', e)
    }
  }
})()







