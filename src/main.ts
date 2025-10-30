﻿/*
  flymd 主入口（中文注释）
  - 极简编辑器：<textarea>
  - Ctrl+E 切换编辑/预览
  - Ctrl+O 打开、Ctrl+S 保存、Ctrl+Shift+S 另存为、Ctrl+N 新建
  - 拖放文件打开
*/

import './style.css'
// KaTeX 样式改为按需动态加载（首次检测到公式时再加载）

// markdown-it 和 DOMPurify 改为按需动态 import，类型仅在编译期引用
import type MarkdownIt from 'markdown-it'

// Tauri 插件（v2）
// Tauri 对话框：使用 ask 提供原生确认，避免浏览器 confirm 在关闭事件中失效
import { open, save, ask } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile, readDir, stat, readFile, mkdir  , rename, remove, writeFile, exists, copyFile } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import { open as openFileHandle, BaseDirectory } from '@tauri-apps/plugin-fs'
// Tauri v2 插件 opener 的导出为 openUrl / openPath，不再是 open
import { openUrl, openPath } from '@tauri-apps/plugin-opener'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import fileTree from './fileTree'
import { uploadImageToS3R2, type UploaderConfig } from './uploader/s3'
import appIconUrl from '../flymd.png?url'
import { decorateCodeBlocks } from './decorate'
import pkg from '../package.json'
import { htmlToMarkdown } from './html2md'
// 应用版本号（用于窗口标题/关于弹窗）
const APP_VERSION: string = (pkg as any)?.version ?? '0.0.0'

type Mode = 'edit' | 'preview'
type LibSortMode = 'name_asc' | 'name_desc' | 'mtime_asc' | 'mtime_desc'

// 最近文件最多条数
const RECENT_MAX = 5

// 渲染器（延迟初始化，首次进入预览时创建）
let md: MarkdownIt | null = null
let sanitizeHtml: ((html: string, cfg?: any) => string) | null = null
let katexCssLoaded = false
let hljsLoaded = false
let mermaidReady = false
// Mermaid 渲染缓存（按源代码文本缓存 SVG，避免重复渲染导致布局抖动）
const mermaidSvgCache = new Map<string, { svg: string; renderId: string }>()
let mermaidSvgCacheVersion = 0

function hashMermaidCode(code: string): string {
  try {
    // WYSIWYG 情况下，在编辑未闭合的 ```mermaid 围栏内时，跳过 Mermaid 渲染以避免每次输入导致整屏重排/闪烁
    const _skipMermaid = (() => {
      if (!wysiwyg) return false
      try {
        const text = editor.value
        const caret = editor.selectionStart >>> 0
        const lines = text.split('\n')
        const caretLine = (() => { try { return text.slice(0, caret).split('\n').length - 1 } catch { return -1 } })()
        let inside = false
        let fenceCh = ''
        let fenceLang = ''
        for (let i = 0; i <= Math.min(Math.max(0, caretLine), lines.length - 1); i++) {
          const ln = lines[i]
          const m = ln.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
          if (m) {
            const ch = m[1][0]
            if (!inside) {
              inside = true
              fenceCh = ch
              fenceLang = (m[2] || '').trim().split(/\s+/)[0]?.toLowerCase() || ''
            } else if (ch === fenceCh) {
              inside = false
              fenceCh = ''
              fenceLang = ''
            }
          }
        }
        return !!(inside && fenceLang === 'mermaid')
      } catch { return false }
    })()
    if (_skipMermaid) { throw new Error('SKIP_MERMAID_RENDER_IN_WYSIWYG') }
    if (!code) return 'mmd-empty'
    let hash = 2166136261 >>> 0 // FNV-1a 32 位初始值
    for (let i = 0; i < code.length; i++) {
      hash ^= code.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return `mmd-${(hash >>> 0).toString(36)}`
  } catch {
    return 'mmd-fallback'
  }
}

function getCachedMermaidSvg(code: string, desiredId: string): string | null {
  try {
    const cached = mermaidSvgCache.get(code)
    if (!cached || !cached.renderId || !cached.svg) return null
    if (!cached.svg.includes('<svg')) return null
    // 将缓存中的旧 ID 替换为当前渲染需要的新 ID，确保 DOM 中 ID 唯一
    return cached.svg.split(cached.renderId).join(desiredId)
  } catch {
    return null
  }
}

function cacheMermaidSvg(code: string, svg: string, renderId: string) {
  try {
    if (!code || !svg || !renderId) return
    mermaidSvgCache.set(code, { svg, renderId })
  } catch {}
}

function invalidateMermaidSvgCache(reason?: string) {
  try {
    mermaidSvgCache.clear()
    mermaidSvgCacheVersion++
    console.log('Mermaid 缓存已清空', reason || '')
  } catch {}
}

try {
  if (typeof window !== 'undefined') {
    ;(window as any).invalidateMermaidSvgCache = invalidateMermaidSvgCache
  }
} catch {}

// 应用状态
let fileTreeReady = false
let mode: Mode = 'edit'
// 所见即所得开关（Overlay 模式）
let wysiwyg = false
let _wysiwygRaf = 0
// 仅在按回车时触发渲染（可选开关，默认关闭）
let wysiwygEnterToRenderOnly = false
// 所见模式：针对行内 $ 与 代码围栏 ``` 的“闭合后需回车再渲染”延迟标记
let wysiwygHoldInlineDollarUntilEnter = false
let wysiwygHoldFenceUntilEnter = false

function shouldDeferWysiwygRender(): boolean {
  return !!(wysiwygEnterToRenderOnly || wysiwygHoldInlineDollarUntilEnter || wysiwygHoldFenceUntilEnter)
}
// 当前行高亮元素
let wysiwygLineEl: HTMLDivElement | null = null
// 点状光标元素与度量缓存
let wysiwygCaretEl: HTMLDivElement | null = null
let wysiwygStatusEl: HTMLDivElement | null = null
let _wysiwygCaretLineIndex = 0
let _wysiwygCaretVisualColumn = 0
let _caretCharWidth = 0
let _caretFontKey = ''
// 点状“光标”闪烁控制（仅所见模式预览中的点）
let _dotBlinkTimer: number | null = null
let _dotBlinkOn = true

function startDotBlink() {
  try {
    if (_dotBlinkTimer != null) return
    _dotBlinkOn = true
    _dotBlinkTimer = window.setInterval(() => {
      _dotBlinkOn = !_dotBlinkOn
      // 闪烁由 CSS 动画驱动；此计时器仅用于保持状态，可按需扩展
    }, 800)
  } catch {}
}

function stopDotBlink() {
  try {
    if (_dotBlinkTimer != null) { clearInterval(_dotBlinkTimer); _dotBlinkTimer = null }
    _dotBlinkOn = false
  } catch {}
}
// 库侧栏选中状态
let selectedFolderPath: string | null = null
let selectedNodeEl: HTMLElement | null = null
function selectLibraryNode(el: HTMLElement | null, path: string | null, isDir: boolean) {
  try {
    if (selectedNodeEl) selectedNodeEl.classList.remove('selected')
    selectedNodeEl = el as any
    if (selectedNodeEl) selectedNodeEl.classList.add('selected')
    selectedFolderPath = (isDir && path) ? path : selectedFolderPath
  } catch {}
}

let currentFilePath: string | null = null
let dirty = false // 是否有未保存更改

// 配置存储（使用 tauri store）
let store: Store | null = null
// 插件管理（简单实现）
type PluginManifest = { id: string; name?: string; version?: string; author?: string; description?: string; main?: string }
type InstalledPlugin = { id: string; name?: string; version?: string; enabled?: boolean; dir: string; main: string; builtin?: boolean; description?: string }
const PLUGINS_DIR = 'flymd/plugins'
const builtinPlugins: InstalledPlugin[] = [
  { id: 'uploader-s3', name: '图床 (S3/R2)', version: 'builtin', enabled: undefined, dir: '', main: '', builtin: true, description: '粘贴/拖拽图片自动上传，支持 S3/R2 直连，使用设置中的凭据。' }
]
const activePlugins = new Map<string, any>() // id -> module
const pluginMenuAdded = new Map<string, boolean>() // 限制每个插件仅添加一个菜单项
let _extOverlayEl: HTMLDivElement | null = null
let _extListHost: HTMLDivElement | null = null
let _extInstallInput: HTMLInputElement | null = null

// 文档阅读/编辑位置持久化（最小实现）
type DocPos = {
  pos: number
  end?: number
  scroll: number
  pscroll: number
  mode: Mode | 'wysiwyg'
  ts: number
}
let _docPosSaveTimer: number | null = null
async function getDocPosMap(): Promise<Record<string, DocPos>> {
  try {
    if (!store) return {}
    const m = await store.get('docPos')
    return (m && typeof m === 'object') ? (m as Record<string, DocPos>) : {}
  } catch { return {} }
}
async function saveCurrentDocPosNow() {
  try {
    if (!currentFilePath) return
    const map = await getDocPosMap()
    map[currentFilePath] = {
      pos: editor.selectionStart >>> 0,
      end: editor.selectionEnd >>> 0,
      scroll: editor.scrollTop >>> 0,
      pscroll: preview.scrollTop >>> 0,
      mode: (wysiwyg ? 'wysiwyg' : mode),
      ts: Date.now(),
    }
    if (store) {
      await store.set('docPos', map)
      await store.save()
    }
  } catch {}
}
function scheduleSaveDocPos() {
  try {
    if (_docPosSaveTimer != null) { clearTimeout(_docPosSaveTimer); _docPosSaveTimer = null }
    _docPosSaveTimer = window.setTimeout(() => { void saveCurrentDocPosNow() }, 400)
  } catch {}
}
async function restoreDocPosIfAny(path?: string) {
  try {
    const p = (path || currentFilePath || '') as string
    if (!p) return
    const map = await getDocPosMap()
    const s = map[p]
    if (!s) return
    // 恢复编辑器光标与滚动
    try {
      const st = Math.max(0, Math.min(editor.value.length, s.pos >>> 0))
      const ed = Math.max(0, Math.min(editor.value.length, (s.end ?? st) >>> 0))
      editor.selectionStart = st
      editor.selectionEnd = ed
      editor.scrollTop = Math.max(0, s.scroll >>> 0)
      refreshStatus()
    } catch {}
    // 恢复预览滚动（需在预览渲染后调用）
    try { preview.scrollTop = Math.max(0, s.pscroll >>> 0) } catch {}
  } catch {}
}

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

    // 优先尝试 AppLog / AppLocalData，成功则返回
    try {
      // @ts-ignore
      const base1: BaseDirectory = (BaseDirectory as any).AppLog ?? BaseDirectory.AppLocalData
      const f1 = await openFileHandle(LOG_NAME, { write: true, append: true, create: true, baseDir: base1 })
      try { await f1.write(data) } finally { await f1.close() }
      return
    } catch {}

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

// ����ȫ���쳣�ͱ����ܾ���־�� Tauri ����Ҳ�ɼ�
try {
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (e: any) => {
      try { void appendLog('ERROR', '��������', e?.error ?? e?.message ?? e) } catch {}
    })
    window.addEventListener('unhandledrejection', (e: any) => {
      try { void appendLog('ERROR', 'Promise δ�������ܾ�', e?.reason ?? e) } catch {}
    })
  }
} catch {}

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

// 统一确认弹框：优先使用 Tauri 原生 ask；浏览器环境回退到 window.confirm
async function confirmNative(message: string, title = '确认') : Promise<boolean> {
  try {
    if (isTauriRuntime() && typeof ask === 'function') {
      try {
        const ok = await ask(message, { title })
        return !!ok
      } catch {}
    }
    // 浏览器环境或 ask 不可用时的降级
    try {
      if (typeof confirm === 'function') return !!confirm(message)
    } catch {}
    // 最安全的默认：不执行破坏性操作
    return false
  } catch {
    return false
  }
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

// 统一读文件兜底：fs 失败则调用后端命令读取
async function readTextFileAnySafe(p: string): Promise<string> {
  try {
    return await readTextFile(p as any)
  } catch (e) {
    try { return await invoke<string>('read_text_file_any', { path: p }) } catch { throw e }
  }
}

// 统一写文件兜底：fs 失败则调用后端命令写入
async function writeTextFileAnySafe(p: string, content: string): Promise<void> {
  try {
    await writeTextFile(p, content)
  } catch (e) {
    try { await invoke('write_text_file_any', { path: p, content }) } catch { throw e }
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
      <div class="menu-item" id="btn-new" title="新建 (Ctrl+N)">新建</div>
      <div class="menu-item" id="btn-open" title="打开 (Ctrl+O)">文件</div>
      <div class="menu-item" id="btn-save" title="保存 (Ctrl+S)">保存</div>
      <div class="menu-item" id="btn-saveas" title="另存为 (Ctrl+Shift+S)">另存为</div>
      <div class="menu-item" id="btn-toggle" title="编辑/预览 (Ctrl+E)">预览</div>
      <div class="menu-item" id="btn-extensions" title="扩展与插件管理">扩展</div>
    </div>
    <div class="filename" id="filename">未命名</div>
  </div>
  <div class="container">
    <textarea id="editor" class="editor" spellcheck="false" placeholder="在此输入 Markdown 文本……"></textarea>
    <div id="preview" class="preview hidden"></div>
    <div class="statusbar" id="status">行 1, 列 1</div>
  </div>
`
try { logInfo('打点:DOM就绪') } catch {}

const editor = document.getElementById('editor') as HTMLTextAreaElement
const preview = document.getElementById('preview') as HTMLDivElement
const filenameLabel = document.getElementById('filename') as HTMLDivElement
const status = document.getElementById('status') as HTMLDivElement

// 所见模式：输入即渲染 + 覆盖式同窗显示
function syncScrollEditorToPreview() {
  try {
    if (!wysiwyg) return
    const er = editor.scrollHeight - editor.clientHeight
    const pr = preview.scrollHeight - preview.clientHeight
    const ratio = er > 0 ? (editor.scrollTop / er) : 0
    const dest = Math.max(0, Math.round(ratio * Math.max(0, pr)))
    if (!Number.isNaN(dest)) preview.scrollTop = dest
    updateWysiwygLineHighlight()
  } catch {}
}

function scheduleWysiwygRender() {
  try {
    if (!wysiwyg) return
    if (shouldDeferWysiwygRender()) { updateWysiwygLineHighlight(); return }
    if (_wysiwygRaf) cancelAnimationFrame(_wysiwygRaf)
    _wysiwygRaf = requestAnimationFrame(async () => {
      try { await renderPreview() } catch {}
      syncScrollEditorToPreview()
      try { ensureWysiwygCaretDotInView() } catch {}
      updateWysiwygCaretDot()
    })
  } catch {}
}

async function setWysiwygEnabled(enable: boolean) {
  try {
    if (wysiwyg === enable) return
    wysiwyg = enable
    const container = document.querySelector('.container') as HTMLDivElement | null
    if (container) container.classList.toggle('wysiwyg', wysiwyg)
  if (wysiwyg) {
      // 进入所见模式时，清理一次延迟标记，避免历史状态影响
      wysiwygHoldInlineDollarUntilEnter = false
      wysiwygHoldFenceUntilEnter = false
      // 使用点状光标替代系统竖线光标
      try { if (container) container.classList.add('no-caret') } catch {}
      try { preview.classList.remove('hidden') } catch {}
      try { if (wysiwygStatusEl) wysiwygStatusEl.classList.add('show') } catch {}
      await renderPreview()
      syncScrollEditorToPreview()
      updateWysiwygLineHighlight(); updateWysiwygCaretDot(); startDotBlink()
    } else {
      if (mode !== 'preview') {
        try { preview.classList.add('hidden') } catch {}
      }
      try { if (container) container.classList.remove('no-caret') } catch {}
      try { if (wysiwygStatusEl) wysiwygStatusEl.classList.remove('show') } catch {}
      if (wysiwygLineEl) wysiwygLineEl.classList.remove('show')
      if (wysiwygCaretEl) wysiwygCaretEl.classList.remove('show')
      // 退出所见模式时清理延迟标记
      wysiwygHoldInlineDollarUntilEnter = false
      wysiwygHoldFenceUntilEnter = false
      stopDotBlink()
    }
    // 更新按钮提示
    try {
      const b = document.getElementById('btn-wysiwyg') as HTMLDivElement | null
      if (b) b.title = (wysiwyg ? '\u9000\u51fa' : '\u5f00\u542f') + '\u6240\u89c1\u6a21\u5f0f (Ctrl+Shift+E)\n' + (wysiwygEnterToRenderOnly ? '\u5f53\u524d: \u56de\u8f66\u518d\u6e32\u67d3 (Ctrl+Shift+R \u5207\u6362)' : '\u5f53\u524d: \u5373\u65f6\u6e32\u67d3 (Ctrl+Shift+R \u5207\u6362)')
    } catch {}
  } catch {}
}

async function toggleWysiwyg() {
  await setWysiwygEnabled(!wysiwyg)
}

function updateWysiwygLineHighlight() {
  try {
    if (!wysiwyg || !wysiwygLineEl) return
    const st = editor.selectionStart >>> 0
    const before = editor.value.slice(0, st)
    const lineIdx = before.split('\n').length - 1
    _wysiwygCaretLineIndex = lineIdx
    const style = window.getComputedStyle(editor)
    let lh = parseFloat(style.lineHeight || '')
    if (!lh || Number.isNaN(lh)) {
      const fs = parseFloat(style.fontSize || '14') || 14
      lh = fs * 1.6
    }
    const padTop = parseFloat(style.paddingTop || '0') || 0
    const top = Math.max(0, Math.round(padTop + lineIdx * lh - editor.scrollTop))
    wysiwygLineEl.style.top = `${top}px`
    wysiwygLineEl.style.height = `${lh}px`
    // 不再显示高亮行，只更新位置（如需恢复，改为添加 show 类）
  } catch {}
}

function measureCharWidth(): number {
  try {
    const style = window.getComputedStyle(editor)
    const font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`
    if (_caretCharWidth > 0 && _caretFontKey === font) return _caretCharWidth
    const canvas = (measureCharWidth as any)._c || document.createElement('canvas')
    ;(measureCharWidth as any)._c = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) return _caretCharWidth || 8
    ctx.font = font
    // 使用 '0' 作为等宽参考字符
    const w = ctx.measureText('0').width
    if (w && w > 0) { _caretCharWidth = w; _caretFontKey = font }
    return _caretCharWidth || 8
  } catch { return _caretCharWidth || 8 }
}

// ����ģʽ������Ҫ�����滬���ƶ���꣬�������ƶ����еļ�����λ���ĳߴ硣
function advanceVisualColumn(column: number, code: number): number {
  if (code === 13 /* \r */) return column
  if (code === 9 /* \t */) {
    const modulo = column % 4
    const step = modulo === 0 ? 4 : 4 - modulo
    return column + step
  }
  return column + 1
}

function calcVisualColumn(segment: string): number {
  let col = 0
  for (let i = 0; i < segment.length; i++) {
    col = advanceVisualColumn(col, segment.charCodeAt(i))
  }
  return col
}

function offsetForVisualColumn(line: string, column: number): number {
  if (!Number.isFinite(column) || column <= 0) return 0
  let col = 0
  for (let i = 0; i < line.length; i++) {
    const code = line.charCodeAt(i)
    const next = advanceVisualColumn(col, code)
    if (next >= column) return i + 1
    col = next
  }
  return line.length
}

function moveWysiwygCaretByLines(deltaLines: number, preferredColumn?: number): number {
  try {
    if (!wysiwyg) return 0
    if (!Number.isFinite(deltaLines) || deltaLines === 0) return 0
    if (editor.selectionStart !== editor.selectionEnd) return 0
    const value = editor.value
    if (!value) return 0
    const len = value.length
    let pos = editor.selectionStart >>> 0
    let lineStart = pos
    while (lineStart > 0 && value.charCodeAt(lineStart - 1) !== 10) lineStart--
    const currentSegment = value.slice(lineStart, pos)
    let column = Number.isFinite(preferredColumn) ? Number(preferredColumn) : calcVisualColumn(currentSegment)
    if (!Number.isFinite(column) || column < 0) column = 0
    const steps = deltaLines > 0 ? Math.floor(deltaLines) : Math.ceil(deltaLines)
    if (steps === 0) return 0
    let moved = 0
    if (steps > 0) {
      let remaining = steps
      while (remaining > 0) {
        const nextNl = value.indexOf('\n', lineStart)
        if (nextNl < 0) { lineStart = len; break }
        lineStart = nextNl + 1
        moved++
        remaining--
      }
    } else {
      let remaining = steps
      while (remaining < 0) {
        if (lineStart <= 0) { lineStart = 0; break }
        const prevNl = value.lastIndexOf('\n', Math.max(0, lineStart - 2))
        lineStart = prevNl >= 0 ? prevNl + 1 : 0
        moved--
        remaining++
      }
    }
    if (moved === 0) return 0
    let lineEnd = value.indexOf('\n', lineStart)
    if (lineEnd < 0) lineEnd = len
    const targetLine = value.slice(lineStart, lineEnd)
    const offset = offsetForVisualColumn(targetLine, column)
    const newPos = lineStart + offset
    editor.selectionStart = editor.selectionEnd = newPos
    return moved
  } catch { return 0 }
}

function updateWysiwygCaretDot() {
  try {
    if (!wysiwyg || !wysiwygCaretEl) return
    // 方案A：使用原生系统光标，禁用自定义覆盖光标
    try { wysiwygCaretEl.classList.remove('show') } catch {}
    const st = editor.selectionStart >>> 0
    const before = editor.value.slice(0, st)
    const style = window.getComputedStyle(editor)
    // 行高
    let lh = parseFloat(style.lineHeight || '')
    if (!lh || Number.isNaN(lh)) { const fs = parseFloat(style.fontSize || '14') || 14; lh = fs * 1.6 }
    const padTop = parseFloat(style.paddingTop || '0') || 0
    const padLeft = parseFloat(style.paddingLeft || '0') || 0
    // 计算当前行与列
    const lastNl = before.lastIndexOf('\n')
    const colStr = lastNl >= 0 ? before.slice(lastNl + 1) : before
    const lineIdx = before.split('\n').length - 1
    // 制表符按 4 个空格估算
    const tab4 = (s: string) => s.replace(/\t/g, '    ')
    const colLen = tab4(colStr).length
    _wysiwygCaretVisualColumn = colLen
    const ch = measureCharWidth()
    const top = Math.max(0, Math.round(padTop + lineIdx * lh - editor.scrollTop))
    const left = Math.max(0, Math.round(padLeft + colLen * ch - editor.scrollLeft))
    // 将光标放在当前行底部，并略微向下微调
    const caretH = (() => { try { return parseFloat(window.getComputedStyle(wysiwygCaretEl).height || '2') || 2 } catch { return 2 } })()
    const baseNudge = 1 // 像素级微调，使光标更贴近底部
    wysiwygCaretEl.style.top = `${Math.max(0, Math.round(top + lh - caretH + baseNudge))}px`
    wysiwygCaretEl.style.left = `${left}px`
    wysiwygCaretEl.classList.add('show')
  } catch {}
}

// 所见模式：输入 ``` 后自动补一个换行，避免预览代码块遮挡模拟光标
// WYSIWYG 
// 
// WYSIWYG 
// 
// WYSIWYG 
// 
// WYSIWYG 
// 
// 
// 
// 在所见模式下，确保预览中的“模拟光标 _”可见
function ensureWysiwygCaretDotInView() {
  try {
    if (!wysiwyg) return
    const dot = preview.querySelector('.caret-dot') as HTMLElement | null
    if (!dot) return
    const pv = preview.getBoundingClientRect()
    const dr = dot.getBoundingClientRect()
    const margin = 10
    if (dr.top < pv.top + margin) {
      preview.scrollTop += dr.top - (pv.top + margin)
    } else if (dr.bottom > pv.bottom - margin) {
      preview.scrollTop += dr.bottom - (pv.bottom - margin)
    }
  } catch {}
}

function autoNewlineAfterBackticksInWysiwyg() {
  try {
    if (!wysiwyg) return
    const pos = editor.selectionStart >>> 0
    if (pos < 3) return
    const last3 = editor.value.slice(pos - 3, pos)
    if (last3 === '```' || last3 === '~~~') {
      const v = editor.value
      // 判断是否为“闭合围栏”：需要位于行首（至多 3 个空格）并且之前处于围栏内部，且围栏字符一致
      const before = v.slice(0, pos)
      const lineStart = before.lastIndexOf('\n') + 1
      const curLine = before.slice(lineStart)
      const fenceRE = /^ {0,3}(```+|~~~+)/
      const preText = v.slice(0, lineStart)
      const preLines = preText.split('\n')
      let insideFence = false
      let fenceCh = ''
      for (const ln of preLines) {
        const m = ln.match(fenceRE)
        if (m) {
          const ch = m[1][0]
          if (!insideFence) { insideFence = true; fenceCh = ch }
          else if (ch === fenceCh) { insideFence = false; fenceCh = '' }
        }
      }
      const m2 = curLine.match(fenceRE)
      const isClosing = !!(m2 && insideFence && m2[1][0] === last3[0])

      // 在光标处插入换行，但将光标保持在换行前，便于继续输入语言标识（如 ```js\n）
      editor.value = v.slice(0, pos) + '\n' + v.slice(pos)
      editor.selectionStart = editor.selectionEnd = pos
      dirty = true
      refreshTitle()

      // 若检测到闭合，则开启“需回车再渲染”的围栏延迟
      if (isClosing) {
        wysiwygHoldFenceUntilEnter = true
      }
    }
  } catch {}
}

// 所见模式：行内数学 $...$ 闭合后，自动在光标处后插入至少 2 个换行，避免新内容与公式渲染重叠
function autoNewlineAfterInlineDollarInWysiwyg() {
  try {
    if (!wysiwyg) return
    const pos = editor.selectionStart >>> 0
    if (pos < 1) return
    const v = editor.value
    // 仅在最新输入字符为 $ 时判定
    if (v[pos - 1] !== '$') return
    // 若是 $$（块级），不处理
    if (pos >= 2 && v[pos - 2] === '$') return

    // 判断是否在代码围栏内，是则不处理
    const before = v.slice(0, pos)
    const lineStart = before.lastIndexOf('\n') + 1
    const fenceRE = /^ {0,3}(```+|~~~+)/
    const preText = v.slice(0, lineStart)
    const preLines = preText.split('\n')
    let insideFence = false
    let fenceCh = ''
    for (const ln of preLines) {
      const m = ln.match(fenceRE)
      if (m) {
        const ch = m[1][0]
        if (!insideFence) { insideFence = true; fenceCh = ch }
        else if (ch === fenceCh) { insideFence = false; fenceCh = '' }
      }
    }
    if (insideFence) return

    // 当前整行（用于检测行内 $ 奇偶）
    const lineEnd = (() => { const i = v.indexOf('\n', lineStart); return i < 0 ? v.length : i })()
    const line = v.slice(lineStart, lineEnd)
    const upto = v.slice(lineStart, pos) // 行首到光标（含刚输入的 $）

    // 统计“未被转义、且不是 $$ 的单个 $”数量
    let singles = 0
    let lastIdx = -1
    for (let i = 0; i < upto.length; i++) {
      if (upto[i] !== '$') continue
      // 跳过 $$（块级）
      if (i + 1 < upto.length && upto[i + 1] === '$') { i++; continue }
      // 跳过转义 \$（奇数个反斜杠）
      let bs = 0
      for (let j = i - 1; j >= 0 && upto[j] === '\\'; j--) bs++
      if ((bs & 1) === 1) continue
      singles++
      lastIdx = i
    }

    // 若刚好闭合（奇->偶）且最后一个单 $ 就是刚输入的这个
    if (singles % 2 === 0 && lastIdx === upto.length - 1) {
      // 行内数学已闭合：延迟渲染，待用户按下回车键后再渲染
      wysiwygHoldInlineDollarUntilEnter = true
      // 仅在当前位置之后补足至少 2 个换行
      let have = 0
      for (let i = pos; i < v.length && i < pos + 3; i++) { if (v[i] === '\n') have++; else break }
      const need = Math.max(0, 3 - have)
      if (need > 0) {
        const ins = '\n'.repeat(need)
        editor.value = v.slice(0, pos) + ins + v.slice(pos)
        const newPos = pos + ins.length
        editor.selectionStart = editor.selectionEnd = newPos
        dirty = true
        refreshTitle()
        refreshStatus()
      }
    }
  } catch {}
}

// 动态添加"最近文件"菜单项
const menubar = document.querySelector('.menubar') as HTMLDivElement
if (menubar) {
  // 统一“打开”按钮文案
  const btnOpen0 = document.getElementById('btn-open') as HTMLDivElement | null
  if (btnOpen0) { btnOpen0.textContent = '\u6253\u5f00'; btnOpen0.title = '\u6253\u5f00 (Ctrl+O)' }
  const recentBtn = document.createElement('div')
  recentBtn.id = 'btn-recent'
  recentBtn.className = 'menu-item'
  recentBtn.title = '最近文件'
  recentBtn.textContent = '\u6700\u8fd1'
  menubar.appendChild(recentBtn)
  const uplBtn = document.createElement('div')
  uplBtn.id = 'btn-uploader'
  uplBtn.className = 'menu-item'
  uplBtn.title = '图床设置'
  uplBtn.textContent = '\u56fe\u5e8a'
      menubar.appendChild(uplBtn)
      // 扩展按钮（如未在首屏模板中渲染，则此处补充）
      try {
        const exists = document.getElementById('btn-extensions') as HTMLDivElement | null
        if (!exists) {
          const extBtn = document.createElement('div')
          extBtn.id = 'btn-extensions'
          extBtn.className = 'menu-item'
          extBtn.title = '扩展与插件管理'
          extBtn.textContent = '\u6269\u5c55'
          menubar.appendChild(extBtn)
        }
      } catch {}
      // 所见模式按钮（放在“关于”左侧）
      const wBtn = document.createElement('div')
      wBtn.id = 'btn-wysiwyg'
      wBtn.className = 'menu-item'
      wBtn.title = '\u6240\u89c1\u6a21\u5f0f (Ctrl+Shift+E)'
      wBtn.textContent = '\u6240\u89c1'
  const libBtn = document.createElement('div')
  libBtn.id = 'btn-library'
  libBtn.className = 'menu-item'
  libBtn.title = "\u6587\u6863\u5e93\u4fa7\u680f"
  libBtn.textContent = "\u5e93"
  // 将“库”按钮插入到“打开”按钮左侧（若获取不到则放到最左）
  const openBtnRef = document.getElementById('btn-open') as HTMLDivElement | null
  if (openBtnRef && openBtnRef.parentElement === menubar) {
    menubar.insertBefore(libBtn, openBtnRef)
  } else {
    menubar.insertBefore(libBtn, menubar.firstChild)
  }
    // ensure new button is after library button
  try {
    const newBtnRef = document.getElementById('btn-new') as HTMLDivElement | null
    if (newBtnRef && newBtnRef.parentElement === menubar) {
      menubar.insertBefore(newBtnRef, libBtn.nextSibling)
    }
  } catch {}
const aboutBtn = document.createElement('div')
  aboutBtn.id = 'btn-about'
  aboutBtn.className = 'menu-item'
  aboutBtn.title = '关于'
      aboutBtn.textContent = '\u5173\u4e8e'
      menubar.appendChild(wBtn)
      // 检查更新按钮
      const updBtn = document.createElement('div')
      updBtn.id = 'btn-update'
      updBtn.className = 'menu-item'
      updBtn.title = '检查更新'
      updBtn.textContent = '\u66f4\u65b0'
      menubar.appendChild(updBtn)
      menubar.appendChild(aboutBtn)
}
const containerEl = document.querySelector('.container') as HTMLDivElement
  if (containerEl) {
  // 修复在所见模式中滚轮无法滚动编辑区的问题：
  // 在容器层捕获 wheel 事件，直接驱动 textarea 的滚动并同步预览
  try {
    const handleWysiwygWheel = (e: WheelEvent) => {
      if (!wysiwyg) return
      try {
        const rawDelta = Number.isFinite(e.deltaY) ? e.deltaY : 0
        if (rawDelta === 0) return
        const style = window.getComputedStyle(editor)
        const fallbackFontSize = parseFloat(style.fontSize || '14') || 14
        const rawLineHeight = parseFloat(style.lineHeight || '')
        const lineHeight = Number.isFinite(rawLineHeight) && rawLineHeight > 0 ? rawLineHeight : fallbackFontSize * 1.6
        const padTop = parseFloat(style.paddingTop || '0') || 0
        let dy = rawDelta
        if (e.deltaMode === 1 /* WheelEvent.DOM_DELTA_LINE */) {
          dy *= lineHeight || 16
        } else if (e.deltaMode === 2 /* WheelEvent.DOM_DELTA_PAGE */) {
          dy *= editor.clientHeight || window.innerHeight || 400
        }
        if (!Number.isFinite(dy) || dy === 0) return
        const max = Math.max(0, editor.scrollHeight - editor.clientHeight)
        const currentTop = editor.scrollTop || 0
        const next = Math.max(0, Math.min(max, currentTop + dy))
        if (Math.abs(next - currentTop) < 0.1) return
        e.preventDefault()
        editor.scrollTop = next
        syncScrollEditorToPreview()
        let caretAdjusted = false
        if (editor.selectionStart === editor.selectionEnd) {
          const lineHeightPx = lineHeight || 16
          const targetLine = Math.max(0, Math.floor((next - padTop) / lineHeightPx))
          const diff = targetLine - _wysiwygCaretLineIndex
          if (diff !== 0) {
            const moved = moveWysiwygCaretByLines(diff, _wysiwygCaretVisualColumn)
            if (moved !== 0) {
              _wysiwygCaretLineIndex += moved
              caretAdjusted = true
            }
          }
        }
        updateWysiwygLineHighlight()
        updateWysiwygCaretDot()
        startDotBlink()
        if (caretAdjusted && !wysiwygEnterToRenderOnly) {
          scheduleWysiwygRender()
        }
      } catch {}
    }
    containerEl.addEventListener('wheel', handleWysiwygWheel, { passive: false } as any)
  } catch {}
  // 所见模式：当前行高亮覆盖层
  try {
    wysiwygLineEl = document.createElement('div') as HTMLDivElement
    wysiwygLineEl.id = 'wysiwyg-line'
    wysiwygLineEl.className = 'wysiwyg-line'
    containerEl.appendChild(wysiwygLineEl)
    wysiwygCaretEl = document.createElement('div') as HTMLDivElement
    wysiwygCaretEl.id = 'wysiwyg-caret'
    wysiwygCaretEl.className = 'wysiwyg-caret'
    containerEl.appendChild(wysiwygCaretEl)
    // 所见模式状态条
    wysiwygStatusEl = document.createElement('div') as HTMLDivElement
    wysiwygStatusEl.id = 'wysiwyg-status'
    wysiwygStatusEl.className = 'wysiwyg-status'
    wysiwygStatusEl.textContent = '所见模式 · 按 Ctrl+Shift+E 退出'
    containerEl.appendChild(wysiwygStatusEl)
  } catch {}
  const panel = document.createElement('div')
  panel.id = 'recent-panel'
  panel.className = 'recent-panel hidden'
  containerEl.appendChild(panel)

  // �ĵ��ⲿ(�ⲿ)
  const library = document.createElement('div')
  library.id = 'library'
  library.className = 'library hidden'
  library.innerHTML = `
    <div class="lib-header">
      <div class="lib-path" id="lib-path"></div>
      <button class="lib-btn" id="lib-choose"></button>
      <button class="lib-btn" id="lib-refresh"></button>
    </div>
    <div class="lib-tree" id="lib-tree"></div>
  `
  containerEl.appendChild(library)
  try {
    const elPath = library.querySelector('#lib-path') as HTMLDivElement | null
    const elChoose = library.querySelector('#lib-choose') as HTMLButtonElement | null
    const elRefresh = library.querySelector('#lib-refresh') as HTMLButtonElement | null
    if (elPath) elPath.textContent = '\u672a\u9009\u62e9\u5e93\u76ee\u5f55'
    if (elChoose) elChoose.textContent = '\u9009\u62e9\u5e93'
    if (elRefresh) elRefresh.textContent = '\u5237\u65b0'
  } catch {}
        // 重新创建关于对话框并挂载
        const about = document.createElement('div')
        about.id = 'about-overlay'
        about.className = 'about-overlay hidden'
        about.innerHTML = `
          <div class="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
            <div class="about-header">
              <div id="about-title">关于  v${APP_VERSION}</div>
              <button id="about-close" class="about-close" title="关闭">×</button>
            </div>
            <div class="about-body">
              <p>跨平台的轻量的Markdown 编辑预览器。</p>
            </div>
          </div>
        `
        containerEl.appendChild(about)
        try {
          const aboutBody = about.querySelector('.about-body') as HTMLDivElement | null
          if (aboutBody) {
            aboutBody.innerHTML = `
              <p>\u4e00\u6b3e\u8de8\u5e73\u53f0\u3001\u8f7b\u91cf\u7a33\u5b9a\u597d\u7528\u7684 Markdown \u7f16\u8f91\u9884\u89c8\u5668\u3002</p>
              <div class="about-subtitle">\u5feb\u6377\u952e</div>
              <div class="about-shortcuts">
                <div class="sc-act">\u6253\u5f00\u6587\u4ef6</div><div class="sc-keys"><kbd>Ctrl</kbd> + <kbd>O</kbd></div>
                <div class="sc-act">\u4fdd\u5b58</div><div class="sc-keys"><kbd>Ctrl</kbd> + <kbd>S</kbd></div>
                <div class="sc-act">\u53e6\u5b58\u4e3a</div><div class="sc-keys"><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd></div>
                <div class="sc-act">\u65b0\u5efa</div><div class="sc-keys"><kbd>Ctrl</kbd> + <kbd>N</kbd></div>
                <div class="sc-act">\u7f16\u8f91/\u9884\u89c8</div><div class="sc-keys"><kbd>Ctrl</kbd> + <kbd>E</kbd></div>
                <div class="sc-act">\u63d2\u5165\u94fe\u63a5</div><div class="sc-keys"><kbd>Ctrl</kbd> + <kbd>K</kbd></div>
                <div class="sc-act">\u52a0\u7c97</div><div class="sc-keys"><kbd>Ctrl</kbd> + <kbd>B</kbd></div>
                <div class="sc-act">\u659c\u4f53</div><div class="sc-keys"><kbd>Ctrl</kbd> + <kbd>I</kbd></div>
                <div class="sc-act">\u9000\u51fa\u9884\u89c8/\u5173\u95ed\u5f39\u7a97</div><div class="sc-keys"><kbd>Esc</kbd></div>
              </div>
              <div class="about-links">
                <p>\u4e2a\u4eba\u7f51\u7ad9\uff1a<a href="https://www.llingfei.com" target="_blank" rel="noopener noreferrer">https://www.llingfei.com</a></p>
                <p>GitHub \u5730\u5740\uff1a<a href="https://github.com/flyhunterl/flymd" target="_blank" rel="noopener noreferrer">https://github.com/flyhunterl/flymd</a></p>
              </div>
            `
          }
          const aboutTitle = about.querySelector('#about-title') as HTMLDivElement | null
          if (aboutTitle) aboutTitle.textContent = `\u5173\u4e8e \u98de\u901fMarkDown (flyMD) v${APP_VERSION}`
          const aboutClose = about.querySelector('#about-close') as HTMLButtonElement | null
          if (aboutClose) { aboutClose.textContent = '\u00D7'; aboutClose.title = '\u5173\u95ed' }
        } catch {}
    try {
    const overlay = document.getElementById('about-overlay') as HTMLDivElement | null
    const dialog = overlay?.querySelector('.about-dialog') as HTMLDivElement | null
    if (dialog) {
      const footer = document.createElement('div')
      footer.className = 'about-footer'
      footer.innerHTML = '<div class="about-footer-links">\
<a href="https://www.llingfei.com" target="_blank" rel="noopener noreferrer">\
  <img class="favicon" src="https://icons.duckduckgo.com/ip3/www.llingfei.com.ico" alt="" referrerpolicy="no-referrer"/>博客\
</a><span class="sep">&nbsp;&nbsp;</span>\
<a href="https://github.com/flyhunterl/flymd" target="_blank" rel="noopener noreferrer">\
  <img class="favicon" src="https://icons.duckduckgo.com/ip3/github.com.ico" alt="" referrerpolicy="no-referrer"/>GitHub\
</a></div><span id="about-version"></span>'
      dialog.appendChild(footer)
      const verEl = footer.querySelector('#about-version') as HTMLSpanElement | null
      if (verEl) verEl.textContent = `v${APP_VERSION}`
    }
    } catch {}

    // 插入链接对话框：初始化并挂载到容器
    const link = document.createElement('div')
    link.id = 'link-overlay'
    link.className = 'link-overlay hidden'
  link.innerHTML = `
      <div class="link-dialog" role="dialog" aria-modal="true" aria-labelledby="link-title">
        <div class="link-header">
          <div id="link-title">插入链接</div>
          <button id="link-close" class="about-close" title="关闭">×</button>
        </div>
        <form class="link-body" id="link-form">
          <label class="link-field">
            <span>文本</span>
            <input id="link-text" type="text" placeholder="链接文本" />
          </label>
          <label class="link-field">
            <span>URL</span>
            <input id="link-url" type="text" placeholder="https://" />
          </label>
          <div class="link-actions">
            <button type="button" id="link-cancel">取消</button>
            <button type="submit" id="link-ok">插入</button>
          </div>
        </form>
    </div>
  `
  containerEl.appendChild(link)

  // 重命名对话框（样式复用“插入链接”对话框风格）
  const rename = document.createElement('div')
  rename.id = 'rename-overlay'
  rename.className = 'link-overlay hidden'
  rename.innerHTML = `
      <div class="link-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title">
        <div class="link-header">
          <div id="rename-title">重命名</div>
          <button id="rename-close" class="about-close" title="关闭">×</button>
        </div>
        <form class="link-body" id="rename-form">
          <label class="link-field">
            <span>名称</span>
            <input id="rename-text" type="text" placeholder="请输入新名称" />
          </label>
          <label class="link-field">
            <span>后缀</span>
            <input id="rename-ext" type="text" disabled />
          </label>
          <div class="link-actions">
            <button type="button" id="rename-cancel">取消</button>
            <button type="submit" id="rename-ok">确定</button>
          </div>
        </form>
    </div>
  `
  containerEl.appendChild(rename)

  // 图床设置对话框
  const upl = document.createElement('div')
  upl.id = 'uploader-overlay'
  upl.className = 'upl-overlay hidden'
  upl.innerHTML = `
    <div class="upl-dialog" role="dialog" aria-modal="true" aria-labelledby="upl-title">
      <div class="upl-header">
        <div id="upl-title">图床设置（S3 / R2）</div>
        <button id="upl-close" class="about-close" title="关闭">×</button>
      </div>
      <div class="upl-desc">用于将粘贴/拖拽的图片自动上传到对象存储，保存后即生效（仅在启用时）。</div>
      <form class="upl-body" id="upl-form">
        <div class="upl-grid">
          <div class="upl-section-title">基础配置</div>
          <label for="upl-enabled">启用</label>
          <div class="upl-field">
            <label class="switch">
              <input id="upl-enabled" type="checkbox" />
              <span class="trk"></span><span class="kn"></span>
            </label>
          </div>
          <label for="upl-always-local">总是保存到本地</label>
          <div class="upl-field">
            <label class="switch">
              <input id="upl-always-local" type="checkbox" />
              <span class="trk"></span><span class="kn"></span>
            </label>
            <div class="upl-hint">开启后，无论图床是否启用，粘贴/拖拽/链接插入的图片都会复制到当前文档同目录的 images 文件夹，并立即生效</div>
          </div>
          <label for="upl-ak">AccessKeyId</label>
          <div class="upl-field"><input id="upl-ak" type="text" placeholder="必填" /></div>
          <label for="upl-sk">SecretAccessKey</label>
          <div class="upl-field"><input id="upl-sk" type="password" placeholder="必填" /></div>
          <label for="upl-bucket">Bucket</label>
          <div class="upl-field"><input id="upl-bucket" type="text" placeholder="必填" /></div>
          <label for="upl-endpoint">自定义节点地址</label>
          <div class="upl-field">
            <input id="upl-endpoint" type="url" placeholder="例如 https://xxx.r2.cloudflarestorage.com" />
            <div class="upl-hint">R2: https://<accountid>.r2.cloudflarestorage.com；S3: https://s3.<region>.amazonaws.com</div>
          </div>
          <label for="upl-region">Region（可选）</label>
          <div class="upl-field"><input id="upl-region" type="text" placeholder="R2 用 auto；S3 如 ap-southeast-1" /></div>
          <div class="upl-section-title">访问域名与路径</div>
          <label for="upl-domain">自定义域名</label>
          <div class="upl-field">
            <input id="upl-domain" type="url" placeholder="例如 https://img.example.com" />
            <div class="upl-hint">填写后将使用该域名生成公开地址</div>
          </div>
          <label for="upl-template">上传路径模板</label>
          <div class="upl-field">
            <input id="upl-template" type="text" placeholder="{year}/{month}{fileName}{md5}.{extName}" />
            <div class="upl-hint">可用变量：{year}{month}{day}{fileName}{md5}{extName}</div>
          </div>
          <div class="upl-section-title">高级选项</div>
          <label for="upl-pathstyle">Path-Style（R2 建议）</label>
          <div class="upl-field"><input id="upl-pathstyle" type="checkbox" /></div>
          <label for="upl-acl">public-read</label>
          <div class="upl-field"><input id="upl-acl" type="checkbox" checked /></div>
        </div>
        <div class="upl-actions">
          <div id="upl-test-result"></div>
          <button type="button" id="upl-test" class="btn-secondary">测试连接</button>
          <button type="button" id="upl-cancel" class="btn-secondary">取消</button>
          <button type="submit" id="upl-save" class="btn-primary">保存</button>
        </div>
      </form>
    </div>
  `
  containerEl.appendChild(upl)
  }

// 打开“插入链接”对话框的 Promise 控制器
let linkDialogResolver: ((result: { label: string; url: string } | null) => void) | null = null

function showLinkOverlay(show: boolean) {
  const overlay = document.getElementById('link-overlay') as HTMLDivElement | null
  if (!overlay) return
  if (show) overlay.classList.remove('hidden')
  else overlay.classList.add('hidden')
}

async function openRenameDialog(stem: string, ext: string): Promise<string | null> {
  try {
    const overlay = document.getElementById('rename-overlay') as HTMLDivElement | null
    const form = overlay?.querySelector('#rename-form') as HTMLFormElement | null
    const inputText = overlay?.querySelector('#rename-text') as HTMLInputElement | null
    const inputExt = overlay?.querySelector('#rename-ext') as HTMLInputElement | null
    const btnCancel = overlay?.querySelector('#rename-cancel') as HTMLButtonElement | null
    const btnClose = overlay?.querySelector('#rename-close') as HTMLButtonElement | null
    if (!overlay || !form || !inputText || !inputExt) {
      const v = prompt('重命名为（不含后缀）：', stem) || ''
      return v.trim() || null
    }
    inputText.value = stem
    inputExt.value = ext
    return await new Promise<string | null>((resolve) => {
      const onSubmit = (e: Event) => { e.preventDefault(); const v = (inputText.value || '').trim(); resolve(v || null); cleanup() }
      const onCancel = () => { resolve(null); cleanup() }
      const onOverlay = (e: MouseEvent) => { if (e.target === overlay) onCancel() }
      function cleanup() {
        overlay.classList.add('hidden')
        try { form.removeEventListener('submit', onSubmit); btnCancel?.removeEventListener('click', onCancel); btnClose?.removeEventListener('click', onCancel); overlay.removeEventListener('click', onOverlay) } catch {}
      }
      form.addEventListener('submit', onSubmit)
      btnCancel?.addEventListener('click', onCancel)
      btnClose?.addEventListener('click', onCancel)
      overlay.addEventListener('click', onOverlay)
      overlay.classList.remove('hidden')
      setTimeout(() => inputText.focus(), 0)
    })
  } catch { return null }
}
async function openLinkDialog(presetLabel: string, presetUrl = 'https://'): Promise<{ label: string; url: string } | null> {
  const overlay = document.getElementById('link-overlay') as HTMLDivElement | null
  const form = overlay?.querySelector('#link-form') as HTMLFormElement | null
  const inputText = overlay?.querySelector('#link-text') as HTMLInputElement | null
  const inputUrl = overlay?.querySelector('#link-url') as HTMLInputElement | null
  const btnCancel = overlay?.querySelector('#link-cancel') as HTMLButtonElement | null
  const btnClose = overlay?.querySelector('#link-close') as HTMLButtonElement | null

  // 如果没有自定义对话框，降级使用 prompt（保持功能可用）
  if (!overlay || !form || !inputText || !inputUrl) {
    const url = prompt('输入链接 URL：', presetUrl) || ''
    if (!url) return null
    const label = presetLabel || '链接文本'
    return { label, url }
  }

  inputText.value = presetLabel || '链接文本'
  inputUrl.value = presetUrl

  return new Promise((resolve) => {
    // 清理并设置 resolver
    linkDialogResolver = (result) => {
      showLinkOverlay(false)
      // 解除事件绑定（一次性）
      try {
        form.removeEventListener('submit', onSubmit)
        btnCancel?.removeEventListener('click', onCancel)
        btnClose?.removeEventListener('click', onCancel)
        overlay.removeEventListener('click', onOverlayClick)
      } catch {}
      resolve(result)
      linkDialogResolver = null
    }

    function onSubmit(e: Event) {
      e.preventDefault()
      const label = (inputText.value || '').trim() || '链接文本'
      const url = (inputUrl.value || '').trim()
      if (!url) { inputUrl.focus(); return }
      linkDialogResolver && linkDialogResolver({ label, url })
    }
    function onCancel() { linkDialogResolver && linkDialogResolver(null) }
    function onOverlayClick(e: MouseEvent) { if (e.target === overlay) onCancel() }

    form.addEventListener('submit', onSubmit)
    btnCancel?.addEventListener('click', onCancel)
    btnClose?.addEventListener('click', onCancel)
    overlay.addEventListener('click', onOverlayClick)
  // 测试连接事件
  showLinkOverlay(true)
    // 聚焦 URL 输入框，便于直接粘贴
    setTimeout(() => inputUrl.focus(), 0)
  })
}
// 更新标题和未保存标记
function refreshTitle() {
  const name = currentFilePath ? currentFilePath.split(/[/\\]/).pop() : '未命名'
  filenameLabel.textContent = name + (dirty ? ' *' : '')
  document.title = `飞速MarkDown v${APP_VERSION} - ${name}${dirty ? ' *' : ''}`
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

// 初始化存储（Tauri Store），失败则退化为内存模式
async function initStore() {
  try {
    console.log('初始化应用存储...')
    // Tauri v2 使用 Store.load，在应用数据目录下持久化
    store = await Store.load('flymd-settings.json')
    console.log('存储初始化成功')
    void logInfo('应用存储初始化成功')
    return true
  } catch (error) {
    console.error('存储初始化失败:', error)
    console.warn('将以无持久化（内存）模式运行')
    void logWarn('存储初始化失败：使用内存模式', error)
    return false
  }
}

// 延迟加载高亮库并创建 markdown-it
async function ensureRenderer() {
  if (md) return
  if (!hljsLoaded) {
    // 按需加载 markdown-it 与 highlight.js
    const [{ default: MarkdownItCtor }, hljs] = await Promise.all([
      import('markdown-it'),
      import('highlight.js')
    ])
    hljsLoaded = true
    md = new MarkdownItCtor({
      html: true,
      linkify: true,
      breaks: true, // 单个换行渲染为 <br>，与所见模式的“回车即提行”保持一致
      highlight(code, lang) {
        // Mermaid 代码块保留为占位容器，稍后由 mermaid 渲染
        if (lang && lang.toLowerCase() === 'mermaid') {
          const esc = code.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]!))
          return `<pre class="mermaid">${esc}</pre>`
        }
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
    // 启用 KaTeX 支持（$...$ / $$...$$）
    try {
      const katexPlugin = (await import('markdown-it-katex')).default as any
      if (typeof katexPlugin === 'function') md.use(katexPlugin)
    } catch (e) {
      console.warn('markdown-it-katex 加载失败：', e)
    }
  }
}

// 渲染预览（带安全消毒）
async function renderPreview() {
  console.log('=== 开始渲染预览 ===')
  // 首次预览开始打点
  try { if (!(renderPreview as any)._firstLogged) { (renderPreview as any)._firstLogged = true; logInfo('打点:首次预览开始') } } catch {}
  await ensureRenderer()
  let raw = editor.value
  // 所见模式：用一个“.”标记插入点，优先不破坏 Markdown 结构
  try {
    if (wysiwyg) {
      const st = editor.selectionStart >>> 0
      const before = raw.slice(0, st)
      const after = raw.slice(st)
      const lineStart = before.lastIndexOf('\n') + 1
      const curLine = before.slice(lineStart)
      const fenceRE = /^ {0,3}(```+|~~~+)/
      // 计算在光标之前是否处于围栏代码块内
      const preText = raw.slice(0, lineStart)
      const preLines = preText.split('\n')
      let insideFence = false
      let fenceCh = ''
      for (const ln of preLines) {
        const m = ln.match(fenceRE)
        if (m) {
          const ch = m[1][0]
          if (!insideFence) { insideFence = true; fenceCh = ch }
          else if (ch === fenceCh) { insideFence = false; fenceCh = '' }
        }
      }
      const isFenceLine = fenceRE.test(curLine)
      let injectAt = st
      // 行首：将点放在不破坏语法的前缀之后
      if (st === lineStart) {
        const mBQ = curLine.match(/^ {0,3}> ?/)
        const mH = curLine.match(/^ {0,3}#{1,6} +/)
        const mUL = curLine.match(/^ {0,3}[-*+] +/)
        const mOL = curLine.match(/^ {0,3}\d+\. +/)
        const prefixLen = (mBQ?.[0]?.length || mH?.[0]?.length || mUL?.[0]?.length || mOL?.[0]?.length || 0)
        if (prefixLen > 0) injectAt = lineStart + prefixLen
      }
      // 围栏行：开围栏行→围栏符之后；关围栏行→跳过
      if (isFenceLine) {
        const m = curLine.match(fenceRE)
        if (m) {
          const ch = m[1][0]
          if (!insideFence) {
            injectAt = lineStart + m[0].length
          } else if (ch === fenceCh) {
            injectAt = -1
          }
        }
      }
      if (injectAt >= 0) {
        // 使用下划线 '_' 作为可见“光标”；代码块中用纯 '_'，其他位置用 span 包裹以实现闪烁
        const dotStr = insideFence && !isFenceLine ? '_' : '<span class="caret-dot">_</span>'
        raw = raw.slice(0, injectAt) + dotStr + raw.slice(injectAt)
      }
      try {
        const lines = raw.split('\n')
        let openFenceIdx = -1
        let openFenceChar = ''
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].match(/^ {0,3}(`{3,}|~{3,})/)
          if (m) {
            const ch = m[1][0]
            if (openFenceIdx < 0) { openFenceIdx = i; openFenceChar = ch }
            else if (ch === openFenceChar) { openFenceIdx = -1; openFenceChar = '' }
          }
        }
        if (openFenceIdx >= 0) {
          lines[openFenceIdx] = lines[openFenceIdx].replace(/^(\s*)(`{3,}|~{3,})/, (_all, s: string, fence: string) => {
            return s + fence[0] + '\u200B' + fence.slice(1)
          })
        }
        let openMathIdx = -1
        for (let i = 0; i < lines.length; i++) {
          if (/^ {0,3}\$\$/.test(lines[i])) {
            if (openMathIdx < 0) openMathIdx = i
            else openMathIdx = -1
          }
        }
        if (openMathIdx >= 0) {
          lines[openMathIdx] = lines[openMathIdx].replace(/^(\s*)\$\$/, (_all, s: string) => s + '$\u200B$')
        }

        // 3) 当前行：未闭合的单个 $（行内数学）
        try {
          if (!insideFence && !isFenceLine) {
            const curIdx = (() => { try { return before.split('\n').length - 1 } catch { return -1 } })()
            if (curIdx >= 0 && curIdx < lines.length) {
              const line = lines[curIdx]
              const singlePos: number[] = []
              for (let i = 0; i < line.length; i++) {
                if (line[i] !== '$') continue
                // 跳过 $$（块级）
                if (i + 1 < line.length && line[i + 1] === '$') { i++; continue }
                // 跳过转义 \$（奇数个反斜杠）
                let bs = 0
                for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) bs++
                if ((bs & 1) === 1) continue
                singlePos.push(i)
              }
              if ((singlePos.length & 1) === 1) {
                const idx = singlePos[singlePos.length - 1]
                // 在单个 $ 后插入零宽字符，阻断 markdown-it-katex 的行内渲染识别
                lines[curIdx] = line.slice(0, idx + 1) + '\u200B' + line.slice(idx + 1)
              }
            }
          }
        } catch {}
        raw = lines.join('\n')
      } catch {}
    }
  } catch {}
  const html = md!.render(raw)
  // 按需加载 KaTeX 样式：检测渲染结果是否包含 katex 片段
  try {
    if (!katexCssLoaded && /katex/.test(html)) {
      await import('katex/dist/katex.min.css')
      katexCssLoaded = true
    }
  } catch {}
  console.log('Markdown 渲染后的 HTML 片段:', html.substring(0, 500))

  // 配置 DOMPurify 允许 SVG 和 MathML
  if (!sanitizeHtml) {
    try {
      const mod: any = await import('dompurify')
      const DOMPurify = mod?.default || mod
      sanitizeHtml = (h: string, cfg?: any) => DOMPurify.sanitize(h, cfg)
    } catch (e) {
      console.error('加载 DOMPurify 失败', e)
      // 最保守回退：不消毒直接渲染（仅调试时），生产不应触达此分支
      sanitizeHtml = (h: string) => h
    }
  }
  const safe = sanitizeHtml!(html, {
    // 允许基础 SVG/Math 相关标签
    ADD_TAGS: ['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g', 'text', 'tspan', 'defs', 'marker', 'use', 'clipPath', 'mask', 'pattern', 'foreignObject'],
    ADD_ATTR: ['viewBox', 'xmlns', 'fill', 'stroke', 'stroke-width', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'transform', 'class', 'id', 'style', 'points', 'preserveAspectRatio', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'markerUnits', 'fill-opacity', 'stroke-dasharray'],
    KEEP_CONTENT: true,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    // 关键修复：放行会在后续被我们转换为 asset: 的 URL 形态，
    // 包含：
    //  - http/https/data/blob/asset 协议
    //  - 以 / 开头的绝对路径（类 Unix）与 ./、../ 相对路径
    //  - Windows 盘符路径（如 D:\\...）与 UNC 路径（\\\\server\\share\\...）
    // 这样 DOMPurify 不会把 img[src] 移除，随后逻辑才能识别并用 convertFileSrc() 转为 asset: URL。
    // 允许以下 URL 形态：
    //  - 常见协议：http/https/data/blob/asset/file
    //  - 绝对/相对路径：/、./、../
    //  - Windows 盘符：D:\ 或 D:/ 或 D:%5C（反斜杠被 URL 编码）或 D:%2F
    //  - 编码后的 UNC：%5C%5Cserver%5Cshare...
    ALLOWED_URI_REGEXP: /^(?:(?:https?|asset|data|blob|file):|\/|\.\.?[\/\\]|[a-zA-Z]:(?:[\/\\]|%5[cC]|%2[fF])|(?:%5[cC]){2})/i
  })

  console.log('DOMPurify 清理后的 HTML 片段:', safe.substring(0, 500))
  // 包裹一层容器，用于样式定宽居中显示
  preview.innerHTML = `<div class="preview-body">${safe}</div>`
  try { decorateCodeBlocks(preview) } catch {}
  // WYSIWYG 防闪烁：使用离屏容器完成 Mermaid 替换后一次性提交
  try {
    preview.classList.add('rendering')
    const buf = document.createElement('div') as HTMLDivElement
    buf.className = 'preview-body'
    buf.innerHTML = safe
    try {
      const codeBlocks = buf.querySelectorAll('pre > code.language-mermaid') as NodeListOf<HTMLElement>
      codeBlocks.forEach((code) => {
        try {
          const pre = code.parentElement as HTMLElement
          const text = code.textContent || ''
          const div = document.createElement('div')
          div.className = 'mermaid'
          div.textContent = text
          pre.replaceWith(div)
        } catch {}
      })
    } catch {}
    try {
      const preMermaid = buf.querySelectorAll('pre.mermaid')
      preMermaid.forEach((pre) => {
        try {
          const text = pre.textContent || ''
          const div = document.createElement('div')
          div.className = 'mermaid'
          div.textContent = text
          pre.replaceWith(div)
        } catch {}
      })
    } catch {}
    try {
      const nodes = Array.from(buf.querySelectorAll('.mermaid')) as HTMLElement[]
      if (nodes.length > 0) {
        let mermaid: any
        try { mermaid = (await import('mermaid')).default } catch (e1) { try { mermaid = (await import('mermaid/dist/mermaid.esm.mjs')).default } catch (e2) { throw e2 } }
        if (!mermaidReady) { mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' }); mermaidReady = true }
        for (let i = 0; i < nodes.length; i++) {
          const el = nodes[i]
          const code = el.textContent || ''
          const hash = hashMermaidCode(code)
          const desiredId = `${hash}-${mermaidSvgCacheVersion}-${i}`
          try {
            let svgMarkup = getCachedMermaidSvg(code, desiredId)
            if (!svgMarkup) {
              const renderId = `${hash}-${Date.now()}-${i}`
              const { svg } = await mermaid.render(renderId, code)
              cacheMermaidSvg(code, svg, renderId)
              svgMarkup = svg.split(renderId).join(desiredId)
            }
            const wrap = document.createElement('div')
            wrap.innerHTML = svgMarkup || ''
            const svgEl = wrap.firstElementChild as SVGElement | null
            if (svgEl) {
              if (!svgEl.id) svgEl.id = desiredId
              el.replaceWith(svgEl)
            }
          } catch {}
        }
      }
    } catch {}
    // 一次性替换预览 DOM
    try {
      preview.innerHTML = ''
      preview.appendChild(buf)
      try { decorateCodeBlocks(preview) } catch {}
    } catch {}
  } catch {} finally { try { preview.classList.remove('rendering') } catch {} }
  // 所见模式下，确保“模拟光标 _”在预览区可见
  try { if (wysiwyg) ensureWysiwygCaretDotInView() } catch {}
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
        let srcDec = src
        try {
          // 尽力解码 URL 编码的反斜杠（%5C）与其它字符，便于后续本地路径识别
          srcDec = decodeURIComponent(src)
        } catch {}
        // 跳过已可用的协议
        if (/^(data:|blob:|asset:|https?:)/i.test(src)) return
        const isWinDrive = /^[a-zA-Z]:/.test(srcDec)
        const isUNC = /^\\\\/.test(srcDec)
        const isUnixAbs = /^\//.test(srcDec)
        // base 不存在且既不是绝对路径、UNC、Windows 盘符，也不是 file: 时，直接忽略
        if (!base && !(isWinDrive || isUNC || isUnixAbs || /^file:/i.test(src) || /^(?:%5[cC]){2}/.test(src))) return
        let abs: string
        if (isWinDrive || isUNC || isUnixAbs) {
          abs = srcDec
          if (isWinDrive) {
            // 统一 Windows 盘符路径分隔符
            abs = abs.replace(/\//g, '\\')
          }
          if (isUNC) {
            // 确保 UNC 使用反斜杠
            abs = abs.replace(/\//g, '\\')
          }
        } else if (/^(?:%5[cC]){2}/.test(src)) {
          // 处理被编码的 UNC：%5C%5Cserver%5Cshare%5C...
          try {
            const unc = decodeURIComponent(src)
            abs = unc.replace(/\//g, '\\')
          } catch { abs = src.replace(/%5[cC]/g, '\\') }
        } else if (/^file:/i.test(src)) {
          // 处理 file:// 形式，本地文件 URI 转为本地系统路径
          try {
            const u = new URL(src)
            let p = u.pathname || ''
            // Windows 场景：/D:/path => D:/path
            if (/^\/[a-zA-Z]:\//.test(p)) p = p.slice(1)
            p = decodeURIComponent(p)
            // 统一为 Windows 反斜杠，交由 convertFileSrc 处理
            if (/^[a-zA-Z]:\//.test(p)) p = p.replace(/\//g, '\\')
            abs = p
          } catch {
            abs = src.replace(/^file:\/\//i, '')
          }
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
        // 先监听错误，若 asset: 加载失败则回退为 data: URL
        let triedFallback = false
        const onError = async () => {
          if (triedFallback) return
          triedFallback = true
          try {
            if (typeof readFile !== 'function') return
            const bytes = await readFile(abs as any)
            // 通过 Blob+FileReader 转 data URL，避免手写 base64
            const mime = (() => {
              const m = (abs || '').toLowerCase().match(/\.([a-z0-9]+)$/)
              switch (m?.[1]) {
                case 'jpg':
                case 'jpeg': return 'image/jpeg'
                case 'png': return 'image/png'
                case 'gif': return 'image/gif'
                case 'webp': return 'image/webp'
                case 'bmp': return 'image/bmp'
                case 'avif': return 'image/avif'
                case 'ico': return 'image/x-icon'
                case 'svg': return 'image/svg+xml'
                default: return 'application/octet-stream'
              }
            })()
            const blob = new Blob([bytes], { type: mime })
            const dataUrl = await new Promise<string>((resolve, reject) => {
              try {
                const fr = new FileReader()
                fr.onerror = () => reject(fr.error || new Error('读取图片失败'))
                fr.onload = () => resolve(String(fr.result || ''))
                fr.readAsDataURL(blob)
              } catch (e) { reject(e as any) }
            })
            el.src = dataUrl
          } catch {}
        }
        el.addEventListener('error', onError, { once: true })

        const url = typeof convertFileSrc === 'function' ? convertFileSrc(abs) : abs
        el.src = url
      } catch {}
    })
  } catch {}

  // Mermaid 渲染：标准化为 <div class="mermaid"> 后逐个渲染为 SVG
  try {
    console.log('=== 开始 Mermaid 渲染流程 ===')
    // 情况1：<pre><code class="language-mermaid">...</code></pre>
    const codeBlocks = preview.querySelectorAll('pre > code.language-mermaid')
    console.log('找到 language-mermaid 代码块数量:', codeBlocks.length)
    codeBlocks.forEach((code) => {
      try {
        const pre = code.parentElement as HTMLElement
        const text = code.textContent || ''
        const div = document.createElement('div')
        div.className = 'mermaid'
        div.textContent = text
        pre.replaceWith(div)
      } catch {}
    })

    // 情况2：<pre class="mermaid">...</pre>
    const preMermaid = preview.querySelectorAll('pre.mermaid')
    console.log('找到 pre.mermaid 元素数量:', preMermaid.length)
    preMermaid.forEach((pre) => {
      try {
        const text = pre.textContent || ''
        const div = document.createElement('div')
        div.className = 'mermaid'
        div.textContent = text
        pre.replaceWith(div)
      } catch {}
    })

    const nodes = Array.from(preview.querySelectorAll('.mermaid')) as HTMLElement[]
    console.log(`找到 ${nodes.length} 个 Mermaid 节点`)
    if (nodes.length > 0) {
      let mermaid: any
      try {
        mermaid = (await import('mermaid')).default
      } catch (e1) {
        console.warn('加载 mermaid 失败，尝试 ESM 备用路径...', e1)
        try {
          mermaid = (await import('mermaid/dist/mermaid.esm.mjs')).default
        } catch (e2) {
          console.error('mermaid ESM 备用路径也加载失败', e2)
          throw e2
        }
      }
      if (!mermaidReady) {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
        mermaidReady = true
        console.log('Mermaid 已初始化')
  try { decorateCodeBlocks(preview) } catch {}
      }
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i]
        const code = el.textContent || ''
        const hash = hashMermaidCode(code)
        const desiredId = `${hash}-${mermaidSvgCacheVersion}-${i}`
        console.log(`渲染 Mermaid 图表 ${i + 1}:`, code.substring(0, 50))
        try {
          let svgMarkup = getCachedMermaidSvg(code, desiredId)
          let cacheHit = false
          if (svgMarkup) {
            cacheHit = true
            console.log(`Mermaid 图表 ${i + 1} 使用缓存，ID: ${desiredId}`)
          } else {
            const renderId = `${hash}-${Date.now()}-${i}`
            const { svg } = await mermaid.render(renderId, code)
            cacheMermaidSvg(code, svg, renderId)
            svgMarkup = svg.split(renderId).join(desiredId)
            console.log(`Mermaid 图表 ${i + 1} 首次渲染完成，缓存已更新`)
          }
          const wrap = document.createElement('div')
          wrap.innerHTML = svgMarkup || ''
          const svgEl = wrap.firstElementChild as SVGElement | null
          console.log(`Mermaid 图表 ${i + 1} SVG 元素:`, svgEl?.tagName, svgEl?.getAttribute('viewBox'))
          if (svgEl) {
            svgEl.setAttribute('data-mmd-hash', hash)
            svgEl.setAttribute('data-mmd-cache', cacheHit ? 'hit' : 'miss')
            if (!svgEl.id) svgEl.id = desiredId
            el.replaceWith(svgEl)
            console.log(`Mermaid 图表 ${i + 1} 已插入 DOM（${cacheHit ? '缓存命中' : '新渲染'}）`)
            setTimeout(() => {
              const check = document.querySelector(`#${svgEl.id}`)
              console.log(`Mermaid 图表 ${i + 1} 检查 DOM 中是否存在:`, check ? '存在' : '不存在')
            }, 100)
          } else {
            throw new Error('生成的 SVG 节点为空')
          }
        } catch (err) {
          console.error('Mermaid 单图渲染失败：', err)
          el.innerHTML = `<div style="color: red; border: 1px solid red; padding: 10px;">Mermaid 渲染错误: ${err}</div>`
        }
      }
    }
  } catch (e) {
    console.error('Mermaid 渲染失败：', e)
  // 代码块装饰：语言角标、行号与复制按钮
  try {
    const codes = Array.from(preview.querySelectorAll('pre > code.hljs')) as HTMLElement[]
    for (const code of codes) {
      const pre = code.parentElement as HTMLElement | null
      if (!pre || pre.getAttribute('data-codebox') === '1') continue
      // 跳过 mermaid（已在前面转换成 div.mermaid）
      if (code.classList.contains('language-mermaid')) continue
      const lang = ((Array.from(code.classList).find(c => c.startsWith('language-')) || '').slice(9) || 'text').toUpperCase()
      // 包装行以生成行号
      try {
        const html = code.innerHTML
        const parts = html.split('\n')
        code.innerHTML = parts.map(p => `<span class="cb-ln">${p || '&nbsp;'}</span>`).join('\n')
      } catch {}
      const box = document.createElement('div')
      box.className = 'codebox'
      const badge = document.createElement('div')
      badge.className = 'code-lang'
      badge.textContent = lang
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'code-copy'
      btn.textContent = '复制'
      if (pre.parentElement) pre.parentElement.insertBefore(box, pre)
      box.appendChild(pre)
      box.appendChild(badge)
      box.appendChild(btn)
      pre.setAttribute('data-codebox', '1')
    }
  } catch {}

  // 首次预览完成打点
  try { if (!(renderPreview as any)._firstDone) { (renderPreview as any)._firstDone = true; logInfo('打点:首次预览完成') } } catch {}
}
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

// 文本格式化与插入工具
function wrapSelection(before: string, after: string, placeholder = '') {
  const start = editor.selectionStart
  const end = editor.selectionEnd
  const val = editor.value
  const selected = val.slice(start, end) || placeholder
  const insert = `${before}${selected}${after}`
  editor.value = val.slice(0, start) + insert + val.slice(end)
  const selStart = start + before.length
  const selEnd = selStart + selected.length
  editor.selectionStart = selStart
  editor.selectionEnd = selEnd
  dirty = true
  refreshTitle()
  refreshStatus()
}

function formatBold() { wrapSelection('**', '**', '加粗文本') }
function formatItalic() { wrapSelection('*', '*', '斜体文本') }
async function insertLink() {
  const start = editor.selectionStart
  const end = editor.selectionEnd
  const val = editor.value
  const labelPreset = val.slice(start, end) || '链接文本'
  const result = await openLinkDialog(labelPreset, 'https://')
  if (!result || !result.url) return
  const insert = `[${result.label}](${result.url})`
  editor.value = val.slice(0, start) + insert + val.slice(end)
  const pos = start + insert.length
  editor.selectionStart = editor.selectionEnd = pos
  dirty = true
  refreshTitle()
  refreshStatus()
}

async function fileToDataUrl(file: File): Promise<string> {
  // 使用 FileReader 生成 data URL，避免手动拼接带来的内存与性能问题
  return await new Promise<string>((resolve, reject) => {
    try {
      const fr = new FileReader()
      fr.onerror = () => reject(fr.error || new Error('读取文件失败'))
      fr.onload = () => resolve(String(fr.result || ''))
      fr.readAsDataURL(file)
    } catch (e) {
      reject(e as any)
    }
  })
}

// 运行时环境检测（是否在 Tauri 中）
function isTauriRuntime(): boolean {
  try {
    // Tauri v1/v2 均可通过以下全局标记判断
    // @ts-ignore
    return typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__)
  } catch { return false }
}

// 更新检测：类型声明（仅用于提示，不强制）
type UpdateAssetInfo = {
  name: string
  size: number
  directUrl: string
  proxyUrl: string
}
type CheckUpdateResp = {
  hasUpdate: boolean
  current: string
  latest: string
  releaseName: string
  notes: string
  htmlUrl: string
  assetWin?: UpdateAssetInfo | null
  assetLinuxAppimage?: UpdateAssetInfo | null
  assetLinuxDeb?: UpdateAssetInfo | null
}

async function openInBrowser(url: string) {
  try {
    if (isTauriRuntime()) { await openUrl(url) }
    else { window.open(url, '_blank', 'noopener,noreferrer') }
  } catch {
    try { window.open(url, '_blank', 'noopener,noreferrer') } catch {}
  }
}

function upMsg(s: string) {
  try { status.textContent = s } catch {}
  try { logInfo('[更新] ' + s) } catch {}
}

function setUpdateBadge(on: boolean, tip?: string) {
  try {
    const btn = document.getElementById('btn-update') as HTMLDivElement | null
    if (!btn) return
    if (on) {
      btn.classList.add('has-update')
      if (tip) {
        // 清理“vv0.x.y”双v问题：将" vv"规整为" v"
        btn.title = tip.replace(' vv', ' v')
      }
    } else {
      btn.classList.remove('has-update')
    }
  } catch {}
}

function ensureUpdateOverlay(): HTMLDivElement {
  const id = 'update-overlay'
  let ov = document.getElementById(id) as HTMLDivElement | null
  if (ov) return ov
  const div = document.createElement('div')
  div.id = id
  div.className = 'link-overlay hidden'
  div.innerHTML = `
    <div class="link-dialog" role="dialog" aria-modal="true" aria-labelledby="update-title">
      <div class="link-header">
        <div id="update-title">检查更新</div>
        <button id="update-close" class="about-close" title="关闭">×</button>
      </div>
      <div class="link-body" id="update-body"></div>
      <div class="link-actions" id="update-actions"></div>
    </div>
  `
  const container = document.querySelector('.container') as HTMLDivElement | null
  if (container) container.appendChild(div)
  const btn = div.querySelector('#update-close') as HTMLButtonElement | null
  if (btn) btn.addEventListener('click', () => div.classList.add('hidden'))
  return div
}

function showUpdateOverlayLinux(resp: CheckUpdateResp) {
  const ov = ensureUpdateOverlay()
  const body = ov.querySelector('#update-body') as HTMLDivElement
  const act = ov.querySelector('#update-actions') as HTMLDivElement
  body.innerHTML = `
    <div style="margin-bottom:8px;">发现新版本：<b>${resp.latest}</b>（当前：${resp.current}）</div>
    <div style="white-space:pre-wrap;max-height:240px;overflow:auto;border:1px solid var(--fg-muted);padding:8px;border-radius:6px;">${(resp.notes||'').replace(/</g,'&lt;')}</div>
  `
  act.innerHTML = ''
  const mkBtn = (label: string, onClick: () => void) => {
    const b = document.createElement('button')
    b.textContent = label
    b.addEventListener('click', onClick)
    act.appendChild(b)
    return b
  }
  if (resp.assetLinuxAppimage) {
    mkBtn('下载 AppImage（代理）', () => { void openInBrowser('https://gh-proxy.com/' + resp.assetLinuxAppimage!.directUrl) })
  }
  if (resp.assetLinuxDeb) {
    mkBtn('下载 DEB（代理）', () => { void openInBrowser('https://gh-proxy.com/' + resp.assetLinuxDeb!.directUrl) })
  }
  mkBtn('前往发布页', () => { void openInBrowser(resp.htmlUrl) })
  mkBtn('关闭', () => ov.classList.add('hidden'))
  ov.classList.remove('hidden')
}

async function checkUpdateInteractive() {
  try {
    upMsg('正在检查更新…')
    const resp = await invoke('check_update', { force: true, include_prerelease: false }) as any as CheckUpdateResp
    if (!resp || !resp.hasUpdate) { setUpdateBadge(false); upMsg(`已是最新版本 v${APP_VERSION}`); return }
    setUpdateBadge(true, `发现新版本 v${resp.latest}`)
    // Windows：自动下载并运行；Linux：展示两个下载链接（依据后端返回的资产类型判断）
    if (resp.assetWin) {
      if (!resp.assetWin) { upMsg('发现新版本，但未找到 Windows 安装包'); await openInBrowser(resp.htmlUrl); return }
      const ok = await confirmNative(`发现新版本 ${resp.latest}（当前 ${resp.current}）\n是否立即下载并安装？`, '更新')
      if (!ok) { upMsg('已取消更新'); return }
      try {
        upMsg('正在下载安装包…')
        let savePath = ''
        {
          const direct = resp.assetWin.directUrl
          const urls = [
            'https://gh-proxy.com/' + direct,
            'https://cdn.gh-proxy.com/' + direct,
            'https://edgeone.gh-proxy.com/' + direct,
            direct,
          ]
          let ok = false
          for (const u of urls) {
            try {
              // 传 useProxy: false，避免后端二次拼接代理
              savePath = await invoke('download_file', { url: u, useProxy: false }) as any as string
              ok = true
              break
            } catch {}
          }
          if (!ok) throw new Error('all proxies failed')
        }
        upMsg('下载完成，正在启动安装…')
        try { await openPath(savePath) } catch { /* 回退：不提示失败，尽量不打断 */ }
      } catch (e) {
        upMsg('下载或启动安装失败，将打开发布页');
        await openInBrowser(resp.htmlUrl)
      }
      return
    }
    // Linux：展示选择
    showUpdateOverlayLinux(resp)
  } catch (e) {
    upMsg('检查更新失败')
  }
}

function checkUpdateSilentOnceAfterStartup() {
  try {
    setTimeout(async () => {
      try {
        const resp = await invoke('check_update', { force: false, include_prerelease: false }) as any as CheckUpdateResp
        if (resp && resp.hasUpdate) {
          setUpdateBadge(true, `发现新版本 v${resp.latest}`)
        }
      } catch {
        // 静默失败不提示
      }
    }, 5000)
  } catch {}
}

// 切换模式
async function toggleMode() {
  mode = mode === 'edit' ? 'preview' : 'edit'
  if (mode === 'preview') {
    await renderPreview()
    preview.classList.remove('hidden')
  } else {
    if (!wysiwyg) preview.classList.add('hidden')
    editor.focus()
  }
  ;(document.getElementById('btn-toggle') as HTMLButtonElement).textContent = mode === 'edit' ? '预览' : '编辑'
}

// 打开文件
async function openFile(preset?: string) {
  try {
    if (!preset && dirty) {
      const confirmed = await confirmNative('当前文件尚未保存，是否放弃更改并继续打开？', '打开文件')
      if (!confirmed) { logDebug('用户取消打开文件操作（未保存）'); return }
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
    // 读取文件内容：优先使用 fs 插件；若因路径权限受限（forbidden path）则回退到自定义后端命令
    let content: string
    try {
      content = await readTextFileAnySafe(selectedPath as any)
    } catch (e: any) {
      const msg = (e && (e.message || e.toString?.())) ? String(e.message || e.toString()) : ''
      if (/forbidden\s*path/i.test(msg) || /not\s*allowed/i.test(msg)) {
        try {
          content = await invoke<string>('read_text_file_any', { path: selectedPath })
        } catch (e2) {
          throw e2
        }
      } else {
        throw e
      }
    }
    editor.value = content
    currentFilePath = selectedPath
    dirty = false
    refreshTitle()
    refreshStatus()
    await switchToPreviewAfterOpen()
    // 打开后恢复上次阅读/编辑位置
    await restoreDocPosIfAny(selectedPath)
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
      const confirmed = await confirmNative('当前文件尚未保存，是否放弃更改并继续打开？', '打开文件')
      if (!confirmed) { logDebug('用户取消打开文件操作（未保存）'); return }
    }

    if (!preset) {
      if (typeof open !== 'function') {
        alert('文件打开功能需要在 Tauri 应用中使用')
        return
      }
    }

    const selected = (typeof preset === 'string')
      ? preset
      : (await open({ multiple: false, filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
        { name: 'PDF', extensions: ['pdf'] },
      ] }))
    if (!selected || Array.isArray(selected)) return

    const selectedPath = normalizePath(selected)
    logDebug('openFile2.selected', { typeof: typeof selected, selected })
    logDebug('openFile2.normalizedPath', { typeof: typeof selectedPath, selectedPath })

    // PDF 预览分支：在读取文本前拦截处理
    try {
      const ext = (selectedPath.split(/\./).pop() || '').toLowerCase()
      if (ext === 'pdf') {
        currentFilePath = selectedPath as any
        dirty = false
        refreshTitle()
        try { (editor as HTMLTextAreaElement).value = '' } catch {}
        // 首选 convertFileSrc 以便 WebView 内置 PDF 查看器接管
        let srcUrl: string = typeof convertFileSrc === 'function' ? convertFileSrc(selectedPath) : (selectedPath as any)
        preview.innerHTML = `
          <div class="pdf-preview" style="width:100%;height:100%;">
            <iframe src="${srcUrl}" title="PDF 预览" style="width:100%;height:100%;border:0;" allow="fullscreen"></iframe>
          </div>
        `
        mode = 'preview'
        try { preview.classList.remove('hidden') } catch {}
        try { syncToggleButton() } catch {}
        await pushRecent(currentFilePath)
        await renderRecentPanel(false)
        logInfo('PDF 预览就绪', { path: selectedPath })
        return
      }
    } catch {}

    // 读取文件内容：优先使用 fs 插件；若因路径权限受限（forbidden path / not allowed）回退到后端命令
    let content: string
    try {
      content = await readTextFileAnySafe(selectedPath as any)
    } catch (e: any) {
      const msg = (e && (e.message || (e.toString?.()))) ? String(e.message || e.toString()) : ''
      const isForbidden = /forbidden\s*path/i.test(msg) || /not\s*allowed/i.test(msg) || /EACCES|EPERM|Access\s*Denied/i.test(msg)
      if (isForbidden && typeof invoke === 'function') {
        // 使用后端无范围限制的读取作为兜底
        content = await invoke<string>('read_text_file_any', { path: selectedPath })
      } else {
        throw e
      }
    }
    editor.value = content
    currentFilePath = selectedPath
    dirty = false
    refreshTitle()
    refreshStatus()
    
    // 打开后默认进入预览模式
    await switchToPreviewAfterOpen()
    // 恢复上次阅读/编辑位置（编辑器光标/滚动与预览滚动）
    await restoreDocPosIfAny(selectedPath)
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
    try {
      await writeTextFileAnySafe(currentFilePath, editor.value)
    } catch (e: any) {
      const msg = (e && (e.message || (e.toString?.()))) ? String(e.message || e.toString()) : ''
      const isForbidden = /forbidden\s*path/i.test(msg) || /not\s*allowed/i.test(msg) || /EACCES|EPERM|Access\s*Denied/i.test(msg)
      if (isForbidden && typeof invoke === 'function') {
        await invoke('write_text_file_any', { path: currentFilePath, content: editor.value })
      } else {
        throw e
      }
    }
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
    try {
      await writeTextFileAnySafe(target, editor.value)
    } catch (e: any) {
      const msg = (e && (e.message || (e.toString?.()))) ? String(e.message || e.toString()) : ''
      const isForbidden = /forbidden\s*path/i.test(msg) || /not\s*allowed/i.test(msg) || /EACCES|EPERM|Access\s*Denied/i.test(msg)
      if (isForbidden && typeof invoke === 'function') {
        await invoke('write_text_file_any', { path: target, content: editor.value })
      } else {
        throw e
      }
    }
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
    const confirmed = await confirmNative('当前文件尚未保存，是否放弃更改并新建？', '新建文件')
    if (!confirmed) return
  }
  editor.value = ''
  currentFilePath = null
  dirty = false
  refreshTitle()
  refreshStatus()
  if (mode === 'preview') {
    await renderPreview()
  } else if (wysiwyg) {
    scheduleWysiwygRender()
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

// 同步预览/编辑按钮文案，避免编码问题
function syncToggleButton() {
  try {
    const btn = document.getElementById('btn-toggle') as HTMLButtonElement | null
    if (btn) btn.textContent = mode === 'edit' ? '\u9884\u89c8' : '\u7f16\u8f91'
  } catch {}
}

// 打开文件后强制切换为预览模式
async function switchToPreviewAfterOpen() {
  if (wysiwyg) {
    try { await renderPreview() } catch (e) { try { showError('Ԥ����Ⱦʧ��', e) } catch {} }
    try { preview.classList.remove('hidden') } catch {}
    try { syncToggleButton() } catch {}
    return
  }
  mode = 'preview'
  try { await renderPreview() } catch (e) { try { showError('预览渲染失败', e) } catch {} }
  try { preview.classList.remove('hidden') } catch {}
  try { syncToggleButton() } catch {}
}

// 绑定事件


// 显示/隐藏 关于 弹窗
// 文档库（阶段A：最小实现）
type LibEntry = { name: string; path: string; isDir: boolean }

async function getLibraryRoot(): Promise<string | null> {
  try {
    if (!store) return null
    const val = await store.get('libraryRoot')
    return (typeof val === 'string' && val) ? val : null
  } catch { return null }
}

async function setLibraryRoot(p: string) {
  try {
    if (!store) return
    await store.set('libraryRoot', p)
    await store.save()
  } catch {}
}

// 库排序偏好（持久化）
async function getLibrarySort(): Promise<LibSortMode> {
  try {
    if (!store) return 'name_asc'
    const val = await store.get('librarySort')
    const s = (typeof val === 'string' ? val : '')
    const allowed: LibSortMode[] = ['name_asc', 'name_desc', 'mtime_asc', 'mtime_desc']
    return (allowed.includes(s as any) ? (s as LibSortMode) : 'name_asc')
  } catch { return 'name_asc' }
}

async function setLibrarySort(mode: LibSortMode) {
  try {
    if (!store) return
    await store.set('librarySort', mode)
    await store.save()
  } catch {}
}

// 粘贴图片默认保存目录（无打开文件时使用）
async function getDefaultPasteDir(): Promise<string | null> {
  try {
    if (!store) return null
    const val = await store.get('defaultPasteDir')
    return (typeof val === 'string' && val) ? val : null
  } catch { return null }
}

async function setDefaultPasteDir(p: string) {
  try {
    if (!store) return
    await store.set('defaultPasteDir', p)
    await store.save()
  } catch {}
}

// 读取直连 S3/R2 上传配置（最小实现）
async function getUploaderConfig(): Promise<UploaderConfig | null> {
  try {
    if (!store) return null
    const up = await store.get('uploader')
    if (!up || typeof up !== 'object') return null
    const o = up as any
    const cfg: UploaderConfig = {
      enabled: !!o.enabled,
      accessKeyId: String(o.accessKeyId || ''),
      secretAccessKey: String(o.secretAccessKey || ''),
      bucket: String(o.bucket || ''),
      region: typeof o.region === 'string' ? o.region : undefined,
      endpoint: typeof o.endpoint === 'string' ? o.endpoint : undefined,
      customDomain: typeof o.customDomain === 'string' ? o.customDomain : undefined,
      keyTemplate: typeof o.keyTemplate === 'string' ? o.keyTemplate : '{year}/{month}{fileName}{md5}.{extName}',
      aclPublicRead: o.aclPublicRead !== false,
      forcePathStyle: o.forcePathStyle !== false,
    }
    if (!cfg.enabled) return null
    if (!cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucket) return null
    return cfg
  } catch { return null }
}

function showUploaderOverlay(show: boolean) {
  const overlay = document.getElementById('uploader-overlay') as HTMLDivElement | null
  if (!overlay) return
  if (show) overlay.classList.remove('hidden')
  else overlay.classList.add('hidden')
}

// 读取“总是保存到本地”配置
async function getAlwaysSaveLocalImages(): Promise<boolean> {
  try {
    if (!store) return false
    const up = await store.get('uploader')
    if (!up || typeof up !== 'object') return false
    return !!(up as any).alwaysLocal
  } catch { return false }
}


// 简单的连通性测试：只验证 Endpoint 可达性（不进行真实上传）
async function testUploaderConnectivity(endpoint: string): Promise<{ ok: boolean; status: number; note: string }> {
  try {
    const ep = (endpoint || "").trim()
    if (!ep) return { ok: false, status: 0, note: "请填写 Endpoint" }
    let u: URL
    try { u = new URL(ep) } catch { return { ok: false, status: 0, note: "Endpoint 非法 URL" } }
    const origin = u.origin
    try {
      const mod: any = await import("@tauri-apps/plugin-http")
      if (mod && typeof mod.fetch === "function") {
        const r = await mod.fetch(origin, { method: "HEAD" })
        const ok = r && (r.ok === true || (typeof r.status === "number" && r.status >= 200 && r.status < 500))
        return { ok, status: r?.status ?? 0, note: ok ? "可访问" : "不可访问" }
      }
    } catch {}
    try {
      const r2 = await fetch(origin as any, { method: "HEAD" as any, mode: "no-cors" as any } as any)
      return { ok: true, status: 0, note: "已发起网络请求" }
    } catch (e: any) { return { ok: false, status: 0, note: e?.message || "网络失败" } }
  } catch (e: any) { return { ok: false, status: 0, note: e?.message || "异常" } }
}
async function openUploaderDialog() {
  const overlay = document.getElementById('uploader-overlay') as HTMLDivElement | null
  const form = overlay?.querySelector('#upl-form') as HTMLFormElement | null
  if (!overlay || !form) return

  const inputEnabled = overlay.querySelector('#upl-enabled') as HTMLInputElement
  const inputAlwaysLocal = overlay.querySelector('#upl-always-local') as HTMLInputElement
  const inputAk = overlay.querySelector('#upl-ak') as HTMLInputElement
  const inputSk = overlay.querySelector('#upl-sk') as HTMLInputElement
  const inputBucket = overlay.querySelector('#upl-bucket') as HTMLInputElement
  const inputEndpoint = overlay.querySelector('#upl-endpoint') as HTMLInputElement
  const inputRegion = overlay.querySelector('#upl-region') as HTMLInputElement
  const inputDomain = overlay.querySelector('#upl-domain') as HTMLInputElement
  const inputTpl = overlay.querySelector('#upl-template') as HTMLInputElement
  const inputPathStyle = overlay.querySelector('#upl-pathstyle') as HTMLInputElement
  const inputAcl = overlay.querySelector('#upl-acl') as HTMLInputElement
  const btnCancel = overlay.querySelector('#upl-cancel') as HTMLButtonElement
  const btnClose = overlay.querySelector('#upl-close') as HTMLButtonElement
  const btnTest = overlay.querySelector('#upl-test') as HTMLButtonElement
  const testRes = overlay.querySelector('#upl-test-result') as HTMLDivElement

  // 预填
  try {
    if (store) {
      const up = (await store.get('uploader')) as any
      inputEnabled.checked = !!up?.enabled
      inputAlwaysLocal.checked = !!up?.alwaysLocal
      inputAk.value = up?.accessKeyId || ''
      inputSk.value = up?.secretAccessKey || ''
      inputBucket.value = up?.bucket || ''
      inputEndpoint.value = up?.endpoint || ''
      inputRegion.value = up?.region || ''
      inputDomain.value = up?.customDomain || ''
      inputTpl.value = up?.keyTemplate || '{year}/{month}{fileName}{md5}.{extName}'
      inputPathStyle.checked = up?.forcePathStyle !== false
      inputAcl.checked = up?.aclPublicRead !== false
    }
  } catch {}

  showUploaderOverlay(true)
  // 开关即时生效：切换启用时立即写入（仅在必填项齐全时生效）
  try {
    const applyImmediate = async () => {
      try {
        const cfg = {
          enabled: !!inputEnabled.checked,
          alwaysLocal: !!inputAlwaysLocal.checked,
          accessKeyId: inputAk.value.trim(),
          secretAccessKey: inputSk.value.trim(),
          bucket: inputBucket.value.trim(),
          endpoint: inputEndpoint.value.trim() || undefined,
          region: inputRegion.value.trim() || undefined,
          customDomain: inputDomain.value.trim() || undefined,
          keyTemplate: inputTpl.value.trim() || '{year}/{month}{fileName}{md5}.{extName}',
          forcePathStyle: !!inputPathStyle.checked,
          aclPublicRead: !!inputAcl.checked,
        }
        if (cfg.enabled && !cfg.alwaysLocal) {
          if (!cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucket) {
            alert('启用上传需要 AccessKeyId、SecretAccessKey、Bucket');
            inputEnabled.checked = false
            return
          }
        }
        if (store) { await store.set('uploader', cfg); await store.save() }
      } catch (e) { console.warn('即时应用图床开关失败', e) }
    }
    inputEnabled.addEventListener('change', () => { void applyImmediate() })
    inputAlwaysLocal.addEventListener('change', () => { void applyImmediate() })
  } catch {}

  const onCancel = () => { showUploaderOverlay(false) }
  const onSubmit = async (e: Event) => {
    e.preventDefault()
    try {
      const cfg = {
        enabled: !!inputEnabled.checked,
        alwaysLocal: !!inputAlwaysLocal.checked,
        accessKeyId: inputAk.value.trim(),
        secretAccessKey: inputSk.value.trim(),
        bucket: inputBucket.value.trim(),
        endpoint: inputEndpoint.value.trim() || undefined,
        region: inputRegion.value.trim() || undefined,
        customDomain: inputDomain.value.trim() || undefined,
        keyTemplate: inputTpl.value.trim() || '{year}/{month}{fileName}{md5}.{extName}',
        forcePathStyle: !!inputPathStyle.checked,
        aclPublicRead: !!inputAcl.checked,
      }
      if (cfg.enabled && !cfg.alwaysLocal) {
        if (!cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucket) {
          alert('启用直传时 AccessKeyId、SecretAccessKey、Bucket 为必填');
          return
        }
      }
      if (store) {
        await store.set('uploader', cfg)
        await store.save()
      }
      showUploaderOverlay(false)
    } catch (err) {
      showError('保存图床设置失败', err)
    } finally {
      form?.removeEventListener('submit', onSubmit)
      btnCancel?.removeEventListener('click', onCancel)
      btnClose?.removeEventListener('click', onCancel)
      overlay?.removeEventListener('click', onOverlayClick)
    }
  }
  const onOverlayClick = (e: MouseEvent) => { if (e.target === overlay) onCancel() }
  form.addEventListener('submit', onSubmit)
  btnCancel.addEventListener('click', onCancel)
  btnClose.addEventListener('click', onCancel)
  overlay.addEventListener('click', onOverlayClick)
}

function showLibrary(show: boolean) {
  const lib = document.getElementById('library') as HTMLDivElement | null
  const container = document.querySelector('.container') as HTMLDivElement | null
  if (!lib || !container) return
  if (show) { lib.classList.remove('hidden'); container.classList.add('with-library') }
  else { lib.classList.add('hidden'); container.classList.remove('with-library') }
}

async function pickLibraryRoot(): Promise<string | null> {
  try {
    const sel = await open({ directory: true, multiple: false } as any)
    if (!sel) return null
    const p = normalizePath(sel)
    if (!p) return null
    await setLibraryRoot(p)
    return p
  } catch (e) {
    showError('选择库目录失败', e)
    return null
  }
}

// 支持的文档后缀判断（库侧栏）
// 允许：md / markdown / txt / pdf
function isSupportedDoc(name: string): boolean { return /\.(md|markdown|txt|pdf)$/i.test(name) }

// 目录递归包含受支持文档的缓存
const libHasDocCache = new Map<string, boolean>()
const libHasDocPending = new Map<string, Promise<boolean>>()

async function dirHasSupportedDocRecursive(dir: string, depth = 20): Promise<boolean> {
  try {
    if (libHasDocCache.has(dir)) return libHasDocCache.get(dir) as boolean
    if (libHasDocPending.has(dir)) return await (libHasDocPending.get(dir) as Promise<boolean>)

    const p = (async (): Promise<boolean> => {
      if (depth <= 0) { libHasDocCache.set(dir, false); return false }
      let entries: any[] = []
      try { entries = await readDir(dir, { recursive: false } as any) as any[] } catch { entries = [] }
      for (const it of (entries || [])) {
        const full: string = typeof it?.path === 'string' ? it.path : (dir + (dir.includes('\\') ? '\\' : '/') + (it?.name || ''))
        const name = (it?.name || full.split(/[\\/]+/).pop() || '') as string
        try { const s = await stat(full); const isDir = !!(s as any)?.isDirectory; if (!isDir && isSupportedDoc(name)) { libHasDocCache.set(dir, true); return true } } catch {}
      }
      for (const it of (entries || [])) {
        const full: string = typeof it?.path === 'string' ? it.path : (dir + (dir.includes('\\') ? '\\' : '/') + (it?.name || ''))
        try { const s = await stat(full); const isDir = !!(s as any)?.isDirectory; if (isDir) { const ok = await dirHasSupportedDocRecursive(full, depth - 1); if (ok) { libHasDocCache.set(dir, true); return true } } } catch {}
      }
      libHasDocCache.set(dir, false); return false
    })()
    libHasDocPending.set(dir, p); const r = await p; libHasDocPending.delete(dir); return r
  } catch { return false }
}

async function listDirOnce(dir: string): Promise<LibEntry[]> {
  try {
    const entries = await readDir(dir, { recursive: false } as any)
    const files: LibEntry[] = []
    const dirCandidates: LibEntry[] = []
    for (const it of (entries as any[] || [])) {
      const p: string = typeof it?.path === 'string' ? it.path : (dir + (dir.includes('\\') ? '\\' : '/') + (it?.name || ''))
      try {
        const s = await stat(p)
        const isDir = !!(s as any)?.isDirectory
        const name = (it?.name || p.split(/[\\/]+/).pop() || '') as string
        if (isDir) {
          dirCandidates.push({ name, path: p, isDir: true })
        } else {
          if (isSupportedDoc(name)) files.push({ name, path: p, isDir: false })
        }
      } catch {}
    }
    const keptDirs: LibEntry[] = []
    for (const d of dirCandidates) {
      if (await dirHasSupportedDocRecursive(d.path)) keptDirs.push(d)
    }
    keptDirs.sort((a, b) => a.name.localeCompare(b.name))
    files.sort((a, b) => a.name.localeCompare(b.name))
    return [...keptDirs, ...files]
  } catch (e) {
    showError('读取库目录失败', e)
    return []
  }
}


// 路径工具与安全检查
function normSep(p: string): string { return p.replace(/[\\/]+/g, p.includes('\\') ? '\\' : '/') }
function isInside(root: string, p: string): boolean {
  try {
    const r = normSep(root).toLowerCase()
    const q = normSep(p).toLowerCase()
    return q.startsWith(r.endsWith('/') || r.endsWith('\\') ? r : r + (r.includes('\\') ? '\\' : '/'))
  } catch { return false }
}
async function ensureDir(dir: string) { try { await mkdir(dir, { recursive: true } as any) } catch {} }

// 文件操作封装
async function moveFileSafe(src: string, dst: string): Promise<void> {
  try { await rename(src, dst) }
  catch {
    const data = await readFile(src)
    await ensureDir(dst.replace(/[\\/][^\\/]*$/, ''))
    await writeFile(dst, data as any)
    try { await remove(src) } catch {}
  }
}
async function renameFileSafe(p: string, newName: string): Promise<string> {
  const base = p.replace(/[\\/][^\\/]*$/, '')
  const dst = base + (base.includes('\\') ? '\\' : '/') + newName
  await moveFileSafe(p, dst)
  return dst
}
// 安全删除：优先直接删除；若为目录或遇到占用异常，尝试递归删除目录内容后再删
async function deleteFileSafe(p: string, permanent = false): Promise<void> {
  console.log('[deleteFileSafe] 开始删除:', { path: p, permanent })

  // 第一步：尝试移至回收站（如果不是永久删除）
  if (!permanent && typeof invoke === 'function') {
    try {
      console.log('[deleteFileSafe] 调用 move_to_trash')
      await invoke('move_to_trash', { path: p })
      // 验证删除是否成功
      const stillExists = await exists(p)
      console.log('[deleteFileSafe] 回收站删除后检查文件是否存在:', stillExists)
      if (!stillExists) {
        console.log('[deleteFileSafe] 文件已成功移至回收站')
        return
      }
      console.warn('[deleteFileSafe] 文件移至回收站后仍然存在，尝试永久删除')
    } catch (e) {
      console.warn('[deleteFileSafe] 移至回收站失败，尝试永久删除:', e)
    }
  }

  // 第二步：永久删除（带重试机制）
  const maxRetries = 3
  let lastError: any = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // 尝试直接删除
      await remove(p)

      // 验证删除是否成功
      const stillExists = await exists(p)
      if (!stillExists) return

      // 文件仍存在，可能需要递归删除目录
      const st: any = await stat(p)
      if (st?.isDirectory) {
        // 递归删除目录中的所有子项
        const ents = (await readDir(p, { recursive: false } as any)) as any[]
        for (const it of ents) {
          const child = typeof it?.path === 'string' ? it.path : (p + (p.includes('\\') ? '\\' : '/') + (it?.name || ''))
          await deleteFileSafe(child, true) // 递归时直接永久删除
        }
        // 删除空目录
        await remove(p)
      } else if (typeof invoke === 'function') {
        // 文件删除失败，尝试后端强制删除
        await invoke('force_remove_path', { path: p })
      }

      // 最终验证
      const finalCheck = await exists(p)
      if (!finalCheck) return

      throw new Error('文件仍然存在（可能被其他程序占用）')
    } catch (e) {
      lastError = e
      // 如果还有重试机会，等待后重试
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)))
        continue
      }
      // 最后一次尝试也失败了
      throw e
    }
  }

  throw lastError ?? new Error('删除失败')
}
async function newFileSafe(dir: string, name = '新建文档.md'): Promise<string> {
  const sep = dir.includes('\\') ? '\\' : '/'
  let n = name, i = 1
  while (await exists(dir + sep + n)) {
    const m = name.match(/^(.*?)(\.[^.]+)$/); const stem = m ? m[1] : name; const ext = m ? m[2] : ''
    n = `${stem} ${++i}${ext}`
  }
  const full = dir + sep + n
  await ensureDir(dir)
  await writeTextFile(full, '# 标题\n\n', {} as any)
  return full
}async function renderDir(container: HTMLDivElement, dir: string) {
  container.innerHTML = ''
  const entries = await listDirOnce(dir)
  for (const e of entries) {
    if (e.isDir) {
      const row = document.createElement('div')
      row.className = 'lib-node lib-dir'
      row.innerHTML = `<svg class="lib-tg" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg><svg class="lib-ico lib-ico-folder" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a 2 2 0 0 1 2-2h4l2 2h8a 2 2 0 0 1 2 2v7a 2 2 0 0 1-2 2H5a 2 2 0 0 1-2-2V7z"/></svg><span class="lib-name">${e.name}</span>`
      ;(row as any).dataset.path = e.path
      const kids = document.createElement('div')
      kids.className = 'lib-children'
      kids.style.display = 'none'
      container.appendChild(row)
      row.addEventListener('dragover', (ev) => {
        ev.preventDefault()
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'
        row.classList.add('selected')
      })
      row.addEventListener('dragleave', () => { row.classList.remove('selected') })
      row.addEventListener('drop', async (ev) => { try { ev.preventDefault(); row.classList.remove('selected'); const src = ev.dataTransfer?.getData('text/plain') || ''; if (!src) return; const base = e.path; const sep = base.includes('\\\\') ? '\\\\' : '/'; const dst = base + sep + (src.split(/[\\\\/]+/).pop() || ''); if (src === dst) return; const root = await getLibraryRoot(); if (!root || !isInside(root, src) || !isInside(root, dst)) { alert('仅允许在库目录内移动'); return } if (await exists(dst)) { const ok = await ask('目标已存在，是否覆盖？'); if (!ok) return } await moveFileSafe(src, dst); if (currentFilePath === src) { currentFilePath = dst as any; refreshTitle() } const treeEl = document.getElementById('lib-tree') as HTMLDivElement | null; if (treeEl && !fileTreeReady) { await fileTree.init(treeEl, { getRoot: getLibraryRoot, onOpenFile: async (p: string) => { await openFile2(p) }, onOpenNewFile: async (p: string) => { await openFile2(p); mode='edit'; preview.classList.add('hidden'); try { (editor as HTMLTextAreaElement).focus() } catch {} } }); fileTreeReady = true } else if (treeEl) { await fileTree.refresh() } } catch (e) { showError('移动失败', e) } })
      container.appendChild(kids)
      let expanded = false
      row.addEventListener('click', async () => {
         selectLibraryNode(row, e.path, true)
        expanded = !expanded
        kids.style.display = expanded ? '' : 'none'
        row.classList.toggle('expanded', expanded)
        if (expanded && kids.childElementCount === 0) {
          await renderDir(kids as HTMLDivElement, e.path)
        }
      })
    } else {
      const row = document.createElement('div')
      const ext = (e.name.split('.').pop() || '').toLowerCase()
      row.className = 'lib-node lib-file file-ext-' + ext
      row.innerHTML = `<img class="lib-ico lib-ico-app" src="${appIconUrl}" alt=""/><span class="lib-name">${e.name}</span>`
       row.setAttribute('draggable','true')
       row.addEventListener('dragstart', (ev) => { try { ev.dataTransfer?.setData('text/plain', e.path) } catch {} })
      row.title = e.path
       ;(row as any).dataset.path = e.path
       row.setAttribute('draggable','true')
       row.addEventListener('dragstart', (ev) => { try { ev.dataTransfer?.setData('text/plain', e.path); if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move' } catch {} })
      row.addEventListener('click', async () => {
        selectLibraryNode(row, e.path, false)
        await openFile2(e.path)
      })
      container.appendChild(row)
    }
  }
}

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
  const btnLibrary = document.getElementById('btn-library')
  const btnAbout = document.getElementById('btn-about')
  const btnUpdate = document.getElementById('btn-update')
  const btnUploader = document.getElementById('btn-uploader')
  const btnWysiwyg = document.getElementById('btn-wysiwyg')

  if (btnOpen) btnOpen.addEventListener('click', guard(() => openFile2()))
  if (btnSave) btnSave.addEventListener('click', guard(() => saveFile()))
  if (btnSaveas) btnSaveas.addEventListener('click', guard(() => saveAs()))
  if (btnToggle) btnToggle.addEventListener('click', guard(() => toggleMode()))
  if (btnWysiwyg) btnWysiwyg.addEventListener('click', guard(() => toggleWysiwyg()))
  if (btnUpdate) btnUpdate.addEventListener('click', guard(() => checkUpdateInteractive()))
  // 代码复制按钮（事件委托）
  // 库侧栏右键菜单
  document.addEventListener('contextmenu', (ev) => {
    const t = ev.target as HTMLElement
    const row = t?.closest?.('.lib-node') as HTMLElement | null
    if (!row) return
    const tree = document.getElementById('lib-tree') as HTMLDivElement | null
    if (!tree || !tree.contains(row)) return
    ev.preventDefault()
    const path = (row as any).dataset?.path as string || ''
    const isDir = row.classList.contains('lib-dir')
    let menu = document.getElementById('lib-ctx') as HTMLDivElement | null
    if (!menu) {
      menu = document.createElement('div') as HTMLDivElement
      menu.id = 'lib-ctx'
      menu.style.position = 'absolute'
      menu.style.zIndex = '9999'
      menu.style.background = getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#fff'
      menu.style.color = getComputedStyle(document.documentElement).getPropertyValue('--fg') || '#111'
      menu.style.border = '1px solid ' + (getComputedStyle(document.documentElement).getPropertyValue('--border') || '#e5e7eb')
      menu.style.borderRadius = '8px'
      menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)'
      menu.style.minWidth = '160px'
      menu.addEventListener('click', (e2) => e2.stopPropagation())
      document.body.appendChild(menu)
    }
    const mkItem = (txt: string, act: () => void) => {
      const a = document.createElement('div') as HTMLDivElement
      a.textContent = txt
      a.style.padding = '8px 12px'
      a.style.cursor = 'pointer'
      a.addEventListener('mouseenter', () => a.style.background = 'rgba(127,127,127,0.12)')
      a.addEventListener('mouseleave', () => a.style.background = 'transparent')
      a.addEventListener('click', () => { act(); hide() })
      return a
    }
    const hide = () => { if (menu) { menu.style.display = 'none' } document.removeEventListener('click', onDoc) }
    const onDoc = () => hide()
    menu.innerHTML = ''
    if (isDir) { menu.appendChild(mkItem('在此新建文档', async () => { try { const p2 = await newFileSafe(path); await openFile2(p2); mode='edit'; preview.classList.add('hidden'); try { (editor as HTMLTextAreaElement).focus() } catch {}; const treeEl = document.getElementById('lib-tree') as HTMLDivElement | null; if (treeEl && !fileTreeReady) { await fileTree.init(treeEl, { getRoot: getLibraryRoot, onOpenFile: async (p: string) => { await openFile2(p) }, onOpenNewFile: async (p: string) => { await openFile2(p); mode='edit'; preview.classList.add('hidden'); try { (editor as HTMLTextAreaElement).focus() } catch {} } }); fileTreeReady = true } else if (treeEl) { await fileTree.refresh() }; const n2 = Array.from((document.getElementById('lib-tree')||document.body).querySelectorAll('.lib-node.lib-dir') as any).find((n:any) => n.dataset?.path === path); if (n2) n2.dispatchEvent(new MouseEvent('click', { bubbles: true })) } catch (e) { showError('新建失败', e) } })) }
    // 拖拽托底：右键“移动到…”以便选择目标目录
    menu.appendChild(mkItem('移动到…', async () => {
      try {
        const root = await getLibraryRoot(); if (!root) { alert('请先选择库目录'); return }
        if (!isInside(root, path)) { alert('仅允许移动库内文件/文件夹'); return }
        if (typeof open !== 'function') { alert('该功能需要在 Tauri 应用中使用'); return }
        const defaultDir = path.replace(/[\\/][^\\/]*$/, '')
        const picked = await open({ directory: true, defaultPath: defaultDir || root }) as any
        const dest = (typeof picked === 'string') ? picked : ((picked as any)?.path || '')
        if (!dest) return
        if (!isInside(root, dest)) { alert('仅允许移动到库目录内'); return }
        const name = (path.split(/[\\/]+/).pop() || '')
        const sep = dest.includes('\\') ? '\\' : '/'
        const dst = dest.replace(/[\\/]+$/, '') + sep + name
        if (dst === path) return
        if (await exists(dst)) {
          const ok = await ask('目标已存在，是否覆盖？')
          if (!ok) return
        }
        await moveFileSafe(path, dst)
        if (currentFilePath === path) { currentFilePath = dst as any; refreshTitle() }
        const treeEl = document.getElementById('lib-tree') as HTMLDivElement | null
        if (treeEl && !fileTreeReady) { await fileTree.init(treeEl, { getRoot: getLibraryRoot, onOpenFile: async (p: string) => { await openFile2(p) }, onOpenNewFile: async (p: string) => { await openFile2(p); mode='edit'; preview.classList.add('hidden'); try { (editor as HTMLTextAreaElement).focus() } catch {} } }); fileTreeReady = true }
        else if (treeEl) { await fileTree.refresh() }
      } catch (e) { showError('移动失败', e) }
    }))
    menu.appendChild(mkItem('重命名', async () => { try { const base = path.replace(/[\\/][^\\/]*$/, ''); const oldFull = path.split(/[\\/]+/).pop() || ''; const m = oldFull.match(/^(.*?)(\.[^.]+)?$/); const oldStem = (m?.[1] || oldFull); const oldExt = (m?.[2] || ''); const newStem = await openRenameDialog(oldStem, oldExt); if (!newStem || newStem === oldStem) return; const name = newStem + oldExt; const dst = base + (base.includes('\\') ? '\\' : '/') + name; if (await exists(dst)) { alert('同名已存在'); return } await moveFileSafe(path, dst); if (currentFilePath === path) { currentFilePath = dst as any; refreshTitle() } const treeEl = document.getElementById('lib-tree') as HTMLDivElement | null; if (treeEl && !fileTreeReady) { await fileTree.init(treeEl, { getRoot: getLibraryRoot, onOpenFile: async (p: string) => { await openFile2(p) }, onOpenNewFile: async (p: string) => { await openFile2(p); mode='edit'; preview.classList.add('hidden'); try { (editor as HTMLTextAreaElement).focus() } catch {} } }); fileTreeReady = true } else if (treeEl) { await fileTree.refresh() }; try { const nodes = Array.from((document.getElementById('lib-tree')||document.body).querySelectorAll('.lib-node') as any) as HTMLElement[]; const node = nodes.find(n => (n as any).dataset?.path === dst); if (node) node.dispatchEvent(new MouseEvent('click', { bubbles: true })) } catch {} } catch (e) { showError('重命名失败', e) } }))
    menu.appendChild(mkItem('删除', async () => { try { console.log('[删除] 右键菜单删除, 路径:', path); const ok = await confirmNative('确定删除？将移至回收站'); console.log('[删除] 用户确认结果:', ok); if (!ok) return; console.log('[删除] 开始删除文件'); await deleteFileSafe(path, false); console.log('[删除] 删除完成'); if (currentFilePath === path) { currentFilePath = null as any; if (editor) (editor as HTMLTextAreaElement).value = ''; if (preview) preview.innerHTML = ''; refreshTitle() } const treeEl = document.getElementById('lib-tree') as HTMLDivElement | null; if (treeEl && !fileTreeReady) { await fileTree.init(treeEl, { getRoot: getLibraryRoot, onOpenFile: async (p: string) => { await openFile2(p) }, onOpenNewFile: async (p: string) => { await openFile2(p); mode='edit'; preview.classList.add('hidden'); try { (editor as HTMLTextAreaElement).focus() } catch {} } }); fileTreeReady = true } else if (treeEl) { await fileTree.refresh() } } catch (e) { showError('删除失败', e) } }))

    // 排列方式（名称/修改时间）
    try {
      const sep = document.createElement('div') as HTMLDivElement
      sep.style.borderTop = '1px solid ' + (getComputedStyle(document.documentElement).getPropertyValue('--border') || '#e5e7eb')
      sep.style.margin = '6px 0'
      menu.appendChild(sep)
      const applySort = async (mode: LibSortMode) => {
        await setLibrarySort(mode)
        try { fileTree.setSort(mode) } catch {}
        try { await fileTree.refresh() } catch {}
      }
      menu.appendChild(mkItem('按名称 A→Z', () => { void applySort('name_asc') }))
      menu.appendChild(mkItem('按名称 Z→A', () => { void applySort('name_desc') }))
      menu.appendChild(mkItem('按修改时间 新→旧', () => { void applySort('mtime_desc') }))
      menu.appendChild(mkItem('按修改时间 旧→新', () => { void applySort('mtime_asc') }))
    } catch {}
    menu.style.left = Math.min(ev.clientX, (window.innerWidth - 180)) + 'px'
    menu.style.top = Math.min(ev.clientY, (window.innerHeight - 120)) + 'px'
    menu.style.display = 'block'
    setTimeout(() => document.addEventListener('click', onDoc, { once: true }), 0)
  })
  document.addEventListener('click', async (ev) => {
    const t = ev?.target as HTMLElement
    if (t && t.classList.contains('code-copy')) {
      ev.preventDefault()
      const box = t.closest('.codebox') as HTMLElement | null
      const pre = box?.querySelector('pre') as HTMLElement | null
      const text = pre ? (pre.textContent || '') : ''
      let ok = false
      try { await navigator.clipboard.writeText(text); ok = true } catch {}
      if (!ok) {
        try {
          const ta = document.createElement('textarea')
          ta.value = text
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
          ok = true
        } catch {}
      }
      t.textContent = ok ? '已复制' : '复制失败'
      setTimeout(() => { (t as HTMLButtonElement).textContent = '复制' }, 1200)
    }
  }, { capture: true })
  // 库重命名/删除快捷键
  
  // 快捷键：插入链接、重命名、删除（库树）
  document.addEventListener('keydown', guard(async (e: KeyboardEvent) => {
    // 开发模式：F12 / Ctrl+Shift+I 打开 DevTools（不影响生产）
    try {
      if ((import.meta as any).env?.DEV) {
        const isF12 = e.key === 'F12'
        const isCtrlShiftI = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'i'
        if (isF12 || isCtrlShiftI) {
          e.preventDefault()
          try { getCurrentWebview().openDevtools() } catch {}
          return
        }
      }
    } catch {}
    // 编辑快捷键（全局）：插入链接 / 加粗 / 斜体
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); guard(insertLink)(); return }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); await toggleWysiwyg(); return }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'r') { e.preventDefault(); wysiwygEnterToRenderOnly = !wysiwygEnterToRenderOnly; try { const b = document.getElementById('btn-wysiwyg') as HTMLDivElement | null; if (b) b.title = (wysiwyg ? '\u6240\u89c1\u6a21\u5f0f' : '') + (wysiwygEnterToRenderOnly ? ' - \u56de\u8f66\u518d\u6e32\u67d3' : ' - \u5373\u65f6\u6e32\u67d3') + ' (Ctrl+Shift+E)'; } catch {}; return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); await toggleMode(); return }
    if (e.ctrlKey && e.key.toLowerCase() === 'b') { e.preventDefault(); guard(formatBold)(); if (mode === 'preview') void renderPreview(); else if (wysiwyg) scheduleWysiwygRender(); return }
    if (e.ctrlKey && e.key.toLowerCase() === 'i') { e.preventDefault(); guard(formatItalic)(); if (mode === 'preview') void renderPreview(); else if (wysiwyg) scheduleWysiwygRender(); return }
    // 文件操作快捷键
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); await openFile2(); return }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); await saveAs(); return }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); await saveFile(); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); await newFile(); return }
    try {
      const lib = document.getElementById('library') as HTMLDivElement | null
      const libVisible = lib && !lib.classList.contains('hidden')
      if (!libVisible) return
      const row = document.querySelector('#lib-tree .lib-node.selected') as HTMLElement | null
      if (!row) return
      const p = (row as any).dataset?.path as string || ''
      if (!p) return
      if (e.key === 'F2') {
        e.preventDefault()
        const base = p.replace(/[\\/][^\\/]*$/, '')
        const oldName = p.split(/[\\/]+/).pop() || ''
        const name = window.prompt('重命名为：', oldName) || ''
        if (!name || name === oldName) return
        const root = await getLibraryRoot(); if (!root) return
        if (!isInside(root, p)) { alert('越权操作禁止'); return }
        const dst = base + (base.includes('\\') ? '\\' : '/') + name
        if (await exists(dst)) { alert('同名已存在'); return }
        await moveFileSafe(p, dst)
        if (currentFilePath === p) { currentFilePath = dst as any; refreshTitle() }
        const treeEl = document.getElementById('lib-tree') as HTMLDivElement | null; if (treeEl && !fileTreeReady) { await fileTree.init(treeEl, { getRoot: getLibraryRoot, onOpenFile: async (p: string) => { await openFile2(p) }, onOpenNewFile: async (p: string) => { await openFile2(p); mode='edit'; preview.classList.add('hidden'); try { (editor as HTMLTextAreaElement).focus() } catch {} } }); fileTreeReady = true } else if (treeEl) { await fileTree.refresh() }
        return
      }
      if (e.key === 'Delete') {
        e.preventDefault()
        console.log('[删除] Delete键被按下, 路径:', p, 'Shift键:', e.shiftKey)
        const isPermanent = e.shiftKey
        const ok = await confirmNative(isPermanent ? '确定永久删除所选项？不可恢复' : '确定删除所选项？将移至回收站')
        console.log('[删除] 用户确认结果:', ok)
        if (!ok) return
        console.log('[删除] 开始删除文件:', p, '永久删除:', isPermanent)
        await deleteFileSafe(p, isPermanent)
        console.log('[删除] 删除完成')
        if (currentFilePath === p) {
          // 清空编辑器和当前文件路径
          currentFilePath = null as any
          if (editor) (editor as HTMLTextAreaElement).value = ''
          if (preview) preview.innerHTML = ''
          refreshTitle()
        }
        const treeEl = document.getElementById('lib-tree') as HTMLDivElement | null; if (treeEl && !fileTreeReady) { await fileTree.init(treeEl, { getRoot: getLibraryRoot, onOpenFile: async (p: string) => { await openFile2(p) }, onOpenNewFile: async (p: string) => { await openFile2(p); mode='edit'; preview.classList.add('hidden'); try { (editor as HTMLTextAreaElement).focus() } catch {} } }); fileTreeReady = true } else if (treeEl) { await fileTree.refresh() }
        return
      }
    } catch (e) { showError('操作失败', e) }
  }))
  if (btnNew) btnNew.addEventListener('click', guard(async () => {
    try {
      const lib = document.getElementById('library') as HTMLDivElement | null
      const libVisible = lib && !lib.classList.contains('hidden')
      let dir = selectedFolderPath || null
      if (!dir) {
        if (currentFilePath) dir = currentFilePath.replace(/[\\/][^\\/]*$/, '')
        if (!dir) dir = await getLibraryRoot()
        if (!dir) dir = await pickLibraryRoot()
      }
      if (!dir) return
      const p = await newFileSafe(dir)
      await openFile2(p)
      mode='edit'; preview.classList.add('hidden'); try { (editor as HTMLTextAreaElement).focus() } catch {}
      const treeEl = document.getElementById('lib-tree') as HTMLDivElement | null
      if (treeEl && !fileTreeReady) { await fileTree.init(treeEl, { getRoot: getLibraryRoot, onOpenFile: async (q: string) => { await openFile2(q) }, onOpenNewFile: async (q: string) => { await openFile2(q); mode='edit'; preview.classList.add('hidden'); try { (editor as HTMLTextAreaElement).focus() } catch {} } }); fileTreeReady = true } else if (treeEl) { await fileTree.refresh() }
      try { const tree = document.getElementById('lib-tree') as HTMLDivElement | null; const nodes = Array.from(tree?.querySelectorAll('.lib-node.lib-dir') || []) as HTMLElement[]; const target = nodes.find(n => (n as any).dataset?.path === dir); if (target) target.dispatchEvent(new MouseEvent('click', { bubbles: true })) } catch {}
      return
    } catch (e) { showError('新建文件失败', e) }
  }))
  if (btnRecent) btnRecent.addEventListener('click', guard(() => renderRecentPanel(true)))
  if (btnLibrary) btnLibrary.addEventListener('click', guard(async () => {
    const lib = document.getElementById('library')
    const showing = lib && !lib.classList.contains('hidden')
    if (showing) { showLibrary(false); return }
    // 显示并准备数据
    showLibrary(true)
    let root = await getLibraryRoot()
    if (!root) root = await pickLibraryRoot()
    const treeEl = document.getElementById('lib-tree') as HTMLDivElement | null; if (treeEl && !fileTreeReady) { await fileTree.init(treeEl, { getRoot: getLibraryRoot, onOpenFile: async (p: string) => { await openFile2(p) }, onOpenNewFile: async (p: string) => { await openFile2(p); mode='edit'; preview.classList.add('hidden'); try { (editor as HTMLTextAreaElement).focus() } catch {} } }); fileTreeReady = true } else if (treeEl) { await fileTree.refresh() }
    // 应用持久化的排序偏好
    try { const s = await getLibrarySort(); fileTree.setSort(s); await fileTree.refresh() } catch {}
  }))
  if (btnAbout) btnAbout.addEventListener('click', guard(() => showAbout(true)))
  if (btnUploader) btnUploader.addEventListener('click', guard(() => openUploaderDialog()))

  // 所见模式：输入/合成结束/滚动时联动渲染与同步
  editor.addEventListener('input', () => { if (wysiwyg) { autoNewlineAfterBackticksInWysiwyg(); autoNewlineAfterInlineDollarInWysiwyg(); if (!shouldDeferWysiwygRender()) scheduleWysiwygRender(); updateWysiwygLineHighlight(); updateWysiwygCaretDot(); startDotBlink() } scheduleSaveDocPos() })
  editor.addEventListener('compositionend', () => { if (wysiwyg) { if (!shouldDeferWysiwygRender()) scheduleWysiwygRender(); updateWysiwygLineHighlight(); updateWysiwygCaretDot(); startDotBlink() } scheduleSaveDocPos() })
  editor.addEventListener('scroll', () => { if (wysiwyg) { syncScrollEditorToPreview(); try { ensureWysiwygCaretDotInView() } catch {}; updateWysiwygCaretDot() } scheduleSaveDocPos() })
  editor.addEventListener('keyup', (e) => { if (wysiwyg) { if ((shouldDeferWysiwygRender()) && e.key === 'Enter') { wysiwygHoldInlineDollarUntilEnter = false; wysiwygHoldFenceUntilEnter = false; scheduleWysiwygRender() } else if (!shouldDeferWysiwygRender()) { void renderPreview() } updateWysiwygLineHighlight(); updateWysiwygCaretDot(); startDotBlink() } scheduleSaveDocPos() })
  editor.addEventListener('click', () => { if (wysiwyg) { if (!shouldDeferWysiwygRender()) void renderPreview(); updateWysiwygLineHighlight(); updateWysiwygCaretDot(); startDotBlink() } scheduleSaveDocPos() })

  // 预览滚动也记录阅读位置
  preview.addEventListener('scroll', () => { scheduleSaveDocPos() })

  // 绑定全局点击（图床弹窗测试按钮）
  document.addEventListener('click', async (ev) => {
    const t = ev?.target as HTMLElement
    if (t && t.id === 'upl-test') {
      ev.preventDefault()
      const overlay = document.getElementById('uploader-overlay') as HTMLDivElement | null
      const testRes = overlay?.querySelector('#upl-test-result') as HTMLDivElement | null
      const ep = (overlay?.querySelector('#upl-endpoint') as HTMLInputElement)?.value || ''
      if (testRes) { testRes.textContent = '测试中...'; (testRes as any).className = ''; testRes.id = 'upl-test-result' }
      try {
        const res = await testUploaderConnectivity(ep)
        if (testRes) { testRes.textContent = res.ok ? '可达' : '不可达'; (testRes as any).className = res.ok ? 'ok' : 'err' }
      } catch (e: any) {
        if (testRes) { testRes.textContent = '测试失败'; (testRes as any).className = 'err' }
      }
    }
  })


  // 文本变化
  editor.addEventListener('input', () => {
    dirty = true
    refreshTitle()
  })
  editor.addEventListener('keyup', refreshStatus)
  editor.addEventListener('click', refreshStatus)
  // 粘贴到编辑器：优先将 HTML 转译为 Markdown；其次处理图片文件占位+异步上传；否则走默认粘贴
  editor.addEventListener('paste', guard(async (e: ClipboardEvent) => {
    try {
      const dt = e.clipboardData
      if (!dt) return

      // 1) 处理 HTML → Markdown（像 Typora 那样保留格式）
      try {
        const hasHtmlType = (dt.types && Array.from(dt.types).some(t => String(t).toLowerCase() === 'text/html'))
        const html = hasHtmlType ? dt.getData('text/html') : ''
        if (html && html.trim()) {
          // 粗略判断是否为“富文本”而非纯文本包装，避免过度拦截
          const looksRich = /<\s*(p|div|h[1-6]|ul|ol|li|pre|table|img|a|blockquote|strong|em|b|i|code)[\s>]/i.test(html)
          if (looksRich) {
            // 按需加载 DOMPurify 做一次基本清洗，避免恶意剪贴板 HTML 注入
            let safe = html
            // 提取 base href 以便相对链接转绝对（若存在）
            let baseUrl: string | undefined
            try {
              const m = html.match(/<base\s+href=["']([^"']+)["']/i)
              if (m && m[1]) baseUrl = m[1]
            } catch {}
            try {
              if (!sanitizeHtml) {
                const mod: any = await import('dompurify')
                const DOMPurify = mod?.default || mod
                sanitizeHtml = (h: string, cfg?: any) => DOMPurify.sanitize(h, cfg)
              }
              safe = sanitizeHtml!(html)
            } catch {}

            // 转成 Markdown 文本
            const mdText = htmlToMarkdown(safe, { baseUrl })
            if (mdText && mdText.trim()) {
              e.preventDefault()
              insertAtCursor(mdText)
              if (mode === 'preview') await renderPreview()
              else if (wysiwyg) scheduleWysiwygRender()
              return
            }
          }
        }
      } catch {}

      // 2) 若包含图片文件，使用占位 + 异步上传
      const items = Array.from(dt.items || [])
      const imgItem = items.find((it) => it.kind === 'file' && /^image\//i.test(it.type))
      if (!imgItem) return

      const file = imgItem.getAsFile()
      if (!file) return

      e.preventDefault()

      // 生成文件名
      const mime = (file.type || '').toLowerCase()
      const ext = (() => {
        if (mime.includes('jpeg')) return 'jpg'
        if (mime.includes('png')) return 'png'
        if (mime.includes('gif')) return 'gif'
        if (mime.includes('webp')) return 'webp'
        if (mime.includes('bmp')) return 'bmp'
        if (mime.includes('avif')) return 'avif'
        if (mime.includes('svg')) return 'svg'
        return 'png'
      })()
      const ts = new Date()
      const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
      const rand = Math.random().toString(36).slice(2, 6)
      const fname = `pasted-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}-${rand}.${ext}`

      // 占位符 + 异步上传，不阻塞编辑
      await startAsyncUploadFromFile(file, fname)
      return
      // 若开启直连上传（S3/R2），优先尝试上传，成功则直接插入外链并返回
      try {
        const upCfg = await getUploaderConfig()
        if (upCfg) {
          const pub = await uploadImageToS3R2(file, fname, file.type || 'application/octet-stream', upCfg)
          insertAtCursor(`![${fname}](${pub.publicUrl})`)
          if (mode === 'preview') await renderPreview()
          else if (wysiwyg) scheduleWysiwygRender()
          else if (wysiwyg) scheduleWysiwygRender()
          return
        }
      } catch (e) {
        console.warn('直连上传失败，改用本地保存/内联', e)
      }

      await startAsyncUploadFromFile(file, fname)
    } catch (err) {
      showError('处理粘贴图片失败', err)
    }
  }))
  // 拖拽到编辑器：插入图片（本地文件或 URL）
  editor.addEventListener('dragover', (e) => { e.preventDefault() })
  editor.addEventListener('drop', async (e) => {
    try {
      e.preventDefault()
      const dt = e.dataTransfer
      if (!dt) return
      const files = Array.from(dt.files || [])
      // 在 Tauri 环境下，文件拖入统一交给 tauri://file-drop 处理，避免与 DOM 层重复
      if (isTauriRuntime() && files.length > 0) {
        return
      }
      if (files.length > 0) {
        // Always-save-local: prefer local images folder
        try {
          const alwaysLocal = await getAlwaysSaveLocalImages()
          if (alwaysLocal) {
            const imgFiles = files.filter((f) => extIsImage(f.name) || (f.type && f.type.startsWith('image/')))
            if (imgFiles.length > 0) {
              const partsLocal: string[] = []
              if (isTauriRuntime() && currentFilePath) {
                const base = currentFilePath.replace(/[\\/][^\\/]*$/, '')
                const sep = base.includes('\\') ? '\\' : '/'
                const imgDir = base + sep + 'images'
                try { await ensureDir(imgDir) } catch {}
                for (const f of imgFiles) {
                  try {
                    const dst = imgDir + sep + f.name
                    const buf = new Uint8Array(await f.arrayBuffer())
                    await writeFile(dst as any, buf as any)
                    const needAngle = /[\s()]/.test(dst) || /^[a-zA-Z]:/.test(dst) || /\\/.test(dst)
                    const mdUrl = needAngle ? `<${dst}>` : dst
                    partsLocal.push(`![${f.name}](${mdUrl})`)
                  } catch {}
                }
                if (partsLocal.length > 0) {
                  insertAtCursor(partsLocal.join('\n'))
                  if (mode === 'preview') await renderPreview()
                  else if (wysiwyg) scheduleWysiwygRender()
                  return
                }
              } else if (isTauriRuntime() && !currentFilePath) {
                const dir = await getDefaultPasteDir()
                if (dir) {
                  const baseDir = dir.replace(/[\\/]+$/, '')
                  const sep = baseDir.includes('\\') ? '\\' : '/'
                  try { await ensureDir(baseDir) } catch {}
                  for (const f of imgFiles) {
                    try {
                      const dst = baseDir + sep + f.name
                      const buf = new Uint8Array(await f.arrayBuffer())
                      await writeFile(dst as any, buf as any)
                      const needAngle = /[\s()]/.test(dst) || /^[a-zA-Z]:/.test(dst) || /\\/.test(dst)
                      const mdUrl = needAngle ? `<${dst}>` : dst
                      partsLocal.push(`![${f.name}](${mdUrl})`)
                    } catch {}
                  }
                  if (partsLocal.length > 0) {
                    insertAtCursor(partsLocal.join('\n'))
                    if (mode === 'preview') await renderPreview()
                    else if (wysiwyg) scheduleWysiwygRender()
                    return
                  }
                }
              }
              // Fallback to data URLs
              const partsData: string[] = []
              for (const f of imgFiles) {
                try { const url = await fileToDataUrl(f); partsData.push(`![${f.name}](${url})`) } catch {}
              }
              if (partsData.length > 0) {
                insertAtCursor(partsData.join('\n'))
                if (mode === 'preview') await renderPreview()
                else if (wysiwyg) scheduleWysiwygRender()
                return
              }
            }
          }
        } catch {}
        // 优先检查是否有 MD 文件（浏览器环境）
        const mdFile = files.find((f) => /\.(md|markdown|txt)$/i.test(f.name))
        if (mdFile) {
          const reader = new FileReader()
          reader.onload = async (evt) => {
            try {
              const content = evt.target?.result as string
              if (content !== null && content !== undefined) {
                if (dirty) {
                  const ok = await confirmNative('当前文件尚未保存，是否放弃更改并打开拖拽的文件？', '打开文件')
                  if (!ok) return
                }
                editor.value = content
                currentFilePath = null
                dirty = false
                refreshTitle()
                refreshStatus()
                if (mode === 'preview') await renderPreview()
                else if (wysiwyg) scheduleWysiwygRender()
                // 拖入 MD 文件后默认预览
                await switchToPreviewAfterOpen()
              }
            } catch (err) {
              showError('读取拖拽的MD文件失败', err)
            }
          }
          reader.onerror = () => showError('文件读取失败', reader.error)
          reader.readAsText(mdFile, 'UTF-8')
          return
        }
        // 若启用直连上传，优先尝试上传到 S3/R2，成功则直接插入外链后返回
        try {
          const upCfg = await getUploaderConfig()
          if (upCfg) {
            const partsUpload: string[] = []
            for (const f of files) {
              if (extIsImage(f.name) || (f.type && f.type.startsWith('image/'))) {
                try {
                  const pub = await uploadImageToS3R2(f, f.name, f.type || 'application/octet-stream', upCfg)
                  partsUpload.push(`![${f.name}](${pub.publicUrl})`)
                } catch (e) {
                  console.warn('直连上传失败，跳过此文件使用本地兜底', f.name, e)
                }
              }
            }
            if (partsUpload.length > 0) {
              insertAtCursor(partsUpload.join('\n'))
              if (mode === 'preview') await renderPreview()
              else if (wysiwyg) scheduleWysiwygRender()
              return
            }
          }
        } catch {}
        // 处理图片
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
        else if (wysiwyg) scheduleWysiwygRender()
      }
    } catch (err) {
      showError('拖拽处理失败', err)
    }
  })

  // 快捷键
  

  // 关闭前确认（未保存）
  // 注意：Windows 平台上在 onCloseRequested 中调用浏览器 confirm 可能被拦截/无效，
  // 使用 Tauri 原生 ask 更稳定；必要时再降级到 confirm。
  try {
    void getCurrentWindow().onCloseRequested(async (event) => {
      if (!dirty) return
      // 先阻止关闭，再进行异步确认，确保不会直接退出
      event.preventDefault()
      // 关闭前尝试保存当前阅读/编辑位置
      try { await saveCurrentDocPosNow() } catch {}
      try {
        // 原生确认对话框（不会导致 Explorer/外壳异常）
        const ok = await ask('当前文件尚未保存，确认退出吗？', { title: '确认退出' })
        if (ok) {
          // 使用 destroy 跳过再次触发 CloseRequested，避免二次询问
          try { await getCurrentWindow().destroy() } catch { /* 忽略 */ }
        }
      } catch (e) {
        // 插件不可用或权限不足时，降级到浏览器 confirm
        const leave = typeof confirm === 'function' ? confirm('当前文件尚未保存，确认退出吗？') : true
        if (leave) {
          try { await getCurrentWindow().destroy() } catch { /* 忽略 */ }
        }
      }
    })
  } catch (e) {
    console.log('窗口关闭监听注册失败（浏览器模式）')
  }

  // 点击外部区域时关闭最近文件面板
  // 浏览器/非 Tauri 环境下的关闭前确认兜底
  try {
    if (!isTauriRuntime()) {
      window.addEventListener('beforeunload', (e) => {
        try { void saveCurrentDocPosNow() } catch {}
        if (dirty) {
          e.preventDefault()
          ;(e as any).returnValue = ''
        }
      })
    }
  } catch {}
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('recent-panel') as HTMLDivElement
    if (!panel || panel.classList.contains('hidden')) return
    const btn = document.getElementById('btn-recent')
    if (btn && !panel.contains(e.target as Node) && e.target !== btn) {
      panel.classList.add('hidden')
    }
  })

  // 库按钮内部操作
  try {
    const chooseBtn = document.getElementById('lib-choose') as HTMLButtonElement | null
    const refreshBtn = document.getElementById('lib-refresh') as HTMLButtonElement | null
    if (chooseBtn) chooseBtn.addEventListener('click', guard(async () => { await pickLibraryRoot(); const treeEl = document.getElementById('lib-tree') as HTMLDivElement | null; if (treeEl && !fileTreeReady) { await fileTree.init(treeEl, { getRoot: getLibraryRoot, onOpenFile: async (p: string) => { await openFile2(p) }, onOpenNewFile: async (p: string) => { await openFile2(p); mode='edit'; preview.classList.add('hidden'); try { (editor as HTMLTextAreaElement).focus() } catch {} } }); fileTreeReady = true } else if (treeEl) { await fileTree.refresh() } try { const s = await getLibrarySort(); fileTree.setSort(s); await fileTree.refresh() } catch {} }))
    if (refreshBtn) refreshBtn.addEventListener('click', guard(async () => { const treeEl = document.getElementById('lib-tree') as HTMLDivElement | null; if (treeEl && !fileTreeReady) { await fileTree.init(treeEl, { getRoot: getLibraryRoot, onOpenFile: async (p: string) => { await openFile2(p) }, onOpenNewFile: async (p: string) => { await openFile2(p); mode='edit'; preview.classList.add('hidden'); try { (editor as HTMLTextAreaElement).focus() } catch {} } }); fileTreeReady = true } else if (treeEl) { await fileTree.refresh() } try { const s = await getLibrarySort(); fileTree.setSort(s); await fileTree.refresh() } catch {} }))
  } catch {}

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
        const DRAG_DROP = (mod as any)?.TauriEvent?.DRAG_DROP ?? 'tauri://drag-drop'
        await getCurrentWindow().listen(DRAG_DROP, async (ev: any) => {
          try {
            const payload: any = ev?.payload ?? ev
            // 仅在真正 drop 时处理（避免 hover/cancel 噪声）
            if (payload && typeof payload === 'object' && payload.action && payload.action !== 'drop') return
            const arr = Array.isArray(payload) ? payload : (payload?.paths || payload?.urls || payload?.files || [])
            const paths: string[] = (Array.isArray(arr) ? arr : []).map((p) => normalizePath(p))
            const md = paths.find((p) => /\.(md|markdown|txt)$/i.test(p))
            if (md) { void openFile2(md); return }
            const imgs = paths.filter((p) => /\.(png|jpe?g|gif|svg|webp|bmp|avif|ico)$/i.test(p))
            if (imgs.length > 0) {
              // Always-save-local: prefer local images folder for dropped files
              try {
                const alwaysLocal = await getAlwaysSaveLocalImages()
                if (alwaysLocal) {
                  const partsLocal: string[] = []
                  if (isTauriRuntime() && currentFilePath) {
                    const base = currentFilePath.replace(/[\\/][^\\/]*$/, '')
                    const sep = base.includes('\\') ? '\\' : '/'
                    const imgDir = base + sep + 'images'
                    try { await ensureDir(imgDir) } catch {}
                    for (const p of imgs) {
                      try {
                        const name = (p.split(/[\\/]+/).pop() || 'image')
                        const dst = imgDir + sep + name
                        const bytes = await readFile(p as any)
                        await writeFile(dst as any, bytes as any)
                        const needAngle = /[\s()]/.test(dst) || /^[a-zA-Z]:/.test(dst) || /\\/.test(dst)
                        const mdUrl = needAngle ? `<${dst}>` : dst
                        partsLocal.push(`![${name}](${mdUrl})`)
                      } catch {}
                    }
                    if (partsLocal.length > 0) {
                      insertAtCursor(partsLocal.join('\n'))
                      if (mode === 'preview') await renderPreview()
                      else if (wysiwyg) scheduleWysiwygRender()
                      return
                    }
                  }
                }
              } catch {}
              // 若启用直连上传，优先尝试上传到 S3/R2
              try {
                const upCfg = await getUploaderConfig()
                if (upCfg) {
                  const toLabel = (p: string) => { const segs = p.split(/[\\/]+/); return segs[segs.length - 1] || 'image' }
                  const parts: string[] = []
                  for (const p of imgs) {
                    try {
                      const name = toLabel(p)
                      const mime = (() => {
                        const m = name.toLowerCase().match(/\.([a-z0-9]+)$/); const ext = m ? m[1] : ''
                        if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
                        if (ext === 'png') return 'image/png'
                        if (ext === 'gif') return 'image/gif'
                        if (ext === 'webp') return 'image/webp'
                        if (ext === 'bmp') return 'image/bmp'
                        if (ext === 'avif') return 'image/avif'
                        if (ext === 'svg') return 'image/svg+xml'
                        if (ext === 'ico') return 'image/x-icon'
                        return 'application/octet-stream'
                      })()
                      const bytes = await readFile(p as any)
                      const blob = new Blob([bytes], { type: mime })
                      const pub = await uploadImageToS3R2(blob, name, mime, upCfg)
                      parts.push(`![${name}](${pub.publicUrl})`)
                    } catch (e) {
                      console.warn('单张图片上传失败，跳过：', p, e)
                      const needAngle = /[\s()]/.test(p) || /^[a-zA-Z]:/.test(p) || /\\/.test(p)
                      parts.push(`![${toLabel(p)}](${needAngle ? `<${p}>` : p})`)
                    }
                  }
                  insertAtCursor(parts.join('\n'))
                  if (mode === 'preview') await renderPreview()
                  else if (wysiwyg) scheduleWysiwygRender()
                  return
                }
              } catch (e) { console.warn('直连上传失败或未配置，回退为本地路径', e) }
              const toLabel = (p: string) => { const segs = p.split(/[\\/]+/); return segs[segs.length - 1] || 'image' }
              // 直接插入原始本地路径；预览阶段会自动转换为 asset: 以便显示
              const toMdUrl = (p: string) => {
                const needAngle = /[\s()]/.test(p) || /^[a-zA-Z]:/.test(p) || /\\/.test(p)
                return needAngle ? `<${p}>` : p
              }
              const text = imgs.map((p) => `![${toLabel(p)}](${toMdUrl(p)})`).join('\n')
              insertAtCursor(text)
              if (mode === 'preview') await renderPreview()
              return
            }
          } catch (err) {
            showError('文件拖拽事件处理失败', err)
          }
        })
        await mod.listen('open-file', (ev: any) => {
          try {
            const payload = ev?.payload ?? ev
            if (typeof payload === 'string' && payload) void openFile2(payload)
          } catch (err) {
            showError('打开方式参数处理失败', err)
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
    console.log('flyMD (飞速MarkDown) 应用启动...')
    try { logInfo('打点:JS启动') } catch {}

    // 尝试初始化存储（失败不影响启动）
    void initStore()

    // 开发模式：不再自动打开 DevTools，改为快捷键触发，避免干扰首屏
    // 快捷键见下方全局 keydown（F12 或 Ctrl+Shift+I）

    // 核心功能：必须执行
    refreshTitle()
    refreshStatus()
    bindEvents()  // 🔧 关键：无论存储是否成功，都要绑定事件
    try { logInfo('打点:事件绑定完成') } catch {}
    // 扩展：初始化目录并激活已启用扩展
    try { await ensurePluginsDir(); await loadAndActivateEnabledPlugins() } catch {}
    // 绑定扩展按钮
    try { const btnExt = document.getElementById('btn-extensions'); if (btnExt) btnExt.addEventListener('click', () => { void showExtensionsOverlay(true) }) } catch {}
    // 开启 DevTools 快捷键（生产/开发环境均可）
    try {
      document.addEventListener('keydown', (e: KeyboardEvent) => {
        const isF12 = e.key === 'F12'
        const isCtrlShiftI = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'i'
        if (isF12 || isCtrlShiftI) { e.preventDefault(); try { getCurrentWebview().openDevtools() } catch {} }
      })
    } catch {}

    // 兜底：主动询问后端是否有“默认程序/打开方式”传入的待打开路径
    try {
      const path = await invoke<string | null>('get_pending_open_path')
      if (path && typeof path === 'string') {
        void openFile2(path)
      }
    } catch {}

    // 尝试加载最近文件（可能失败）
    try {
      void renderRecentPanel(false)
    } catch (e) {
      console.warn('最近文件面板加载失败:', e)
    }

    setTimeout(() => { try { editor.focus() } catch {}; try { logInfo('打点:可输入') } catch {} }, 0)
    // 可交互后预热常用动态模块（不阻塞首屏）
    try {
      const ric: any = (window as any).requestIdleCallback || ((cb: any) => setTimeout(cb, 200))
      ric(async () => {
        try {
          await Promise.allSettled([
            import('markdown-it'),
            import('dompurify'),
            import('highlight.js'),
          ])
        } catch {}
      })
    } catch {}
    console.log('应用初始化完成')
    void logInfo('flyMD (飞速MarkDown) 应用初始化完成')
    // 启动后 5 秒进行一次静默检查，仅加红点提示
    checkUpdateSilentOnceAfterStartup()
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





// ========= 粘贴/拖拽异步上传占位支持 =========
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceUploadingPlaceholder(id: string, replacementMarkdown: string) {
  try {
    const token = `uploading://${id}`
    const re = new RegExp(`!\\[[^\\]]*\\]\\(${escapeRegExp(token)}\\)`) // 只替换第一个占位
    const before = editor.value
    if (re.test(before)) {
      editor.value = before.replace(re, replacementMarkdown)
      dirty = true
      refreshTitle()
      refreshStatus()
      if (mode === 'preview') void renderPreview()
      else if (wysiwyg) scheduleWysiwygRender()
    }
  } catch {}
}

function genUploadId(): string {
  return `upl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function startAsyncUploadFromFile(file: File, fname: string): Promise<void> {
  const id = genUploadId()
  insertAtCursor(`![${fname || 'image'}](uploading://${id})`)
  void (async () => {
    try {
      const alwaysLocal = await getAlwaysSaveLocalImages()
      if (alwaysLocal) {
        // 优先保存到当前文档同目录 images/
        try {
          if (isTauriRuntime() && currentFilePath) {
            const base = currentFilePath.replace(/[\\/][^\\/]*$/, '')
            const sep = base.includes('\\') ? '\\' : '/'
            const imgDir = base + sep + 'images'
            try { await ensureDir(imgDir) } catch {}
            const dst = imgDir + sep + fname
            try {
              const buf = new Uint8Array(await file.arrayBuffer())
              await writeFile(dst as any, buf as any)
              const needAngle = /[\s()]/.test(dst) || /^[a-zA-Z]:/.test(dst) || /\\/.test(dst)
              const mdUrl = needAngle ? `<${dst}>` : dst
              replaceUploadingPlaceholder(id, `![${fname}](${mdUrl})`)
              return
            } catch {}
          }
        } catch {}
        // 未保存的文档：尝试默认粘贴目录
        try {
          if (isTauriRuntime() && !currentFilePath) {
            const dir = await getDefaultPasteDir()
            if (dir) {
              const baseDir = dir.replace(/[\\/]+$/, '')
              const sep = baseDir.includes('\\') ? '\\' : '/'
              const dst = baseDir + sep + fname
              try {
                const buf = new Uint8Array(await file.arrayBuffer())
                try { await ensureDir(baseDir) } catch {}
                await writeFile(dst as any, buf as any)
                const needAngle = /[\s()]/.test(dst) || /^[a-zA-Z]:/.test(dst) || /\\/.test(dst)
                const mdUrl = needAngle ? `<${dst}>` : dst
                replaceUploadingPlaceholder(id, `![${fname}](${mdUrl})`)
                return
              } catch {}
            }
          }
        } catch {}
        // 兜底：data URL
        try {
          const dataUrl = await fileToDataUrl(file)
          replaceUploadingPlaceholder(id, `![${fname}](${dataUrl})`)
          return
        } catch {}
      }
    } catch {}
    try {
      const upCfg = await getUploaderConfig()
      if (upCfg) {
        const res = await uploadImageToS3R2(file, fname, file.type || 'application/octet-stream', upCfg)
        replaceUploadingPlaceholder(id, `![${fname}](${res.publicUrl})`)
        return
      }
    } catch {}
    // 新增：在未配置图床时，优先尝试将粘贴图片落盘到与当前文档同级的 images/ 目录，并插入相对路径
    try {
      if (isTauriRuntime() && currentFilePath) {
        const base = currentFilePath.replace(/[\\/][^\\/]*$/, '')
        const sep = base.includes('\\') ? '\\' : '/'
        const imgDir = base + sep + 'images'
        try { await ensureDir(imgDir) } catch {}
        const dst = imgDir + sep + fname
        try {
          const buf = new Uint8Array(await file.arrayBuffer())
          await writeFile(dst as any, buf as any)
          // 与拖拽一致：优先使用本地绝对路径，必要时用尖括号包裹
          const needAngle = /[\s()]/.test(dst) || /^[a-zA-Z]:/.test(dst) || /\\/.test(dst)
          const mdUrl = needAngle ? `<${dst}>` : dst
          replaceUploadingPlaceholder(id, `![${fname}](${mdUrl})`)
          return
        } catch {}
      }
    } catch {}
    // 新增：未保存的新文档场景，若配置了默认粘贴目录，则将图片落盘到该目录并插入本地路径
    try {
      if (isTauriRuntime() && !currentFilePath) {
        const dir = await getDefaultPasteDir()
        if (dir) {
          const baseDir = dir.replace(/[\\/]+$/, '')
          const sep = baseDir.includes('\\') ? '\\' : '/'
          const dst = baseDir + sep + fname
          try {
            const buf = new Uint8Array(await file.arrayBuffer())
            try { await ensureDir(baseDir) } catch {}
            await writeFile(dst as any, buf as any)
            const needAngle = /[\s()]/.test(dst) || /^[a-zA-Z]:/.test(dst) || /\\/.test(dst)
            const mdUrl = needAngle ? `<${dst}>` : dst
            replaceUploadingPlaceholder(id, `![${fname}](${mdUrl})`)
            return
          } catch {}
        }
        // 未设置默认粘贴目录，则回退保存到用户图片目录（Windows/Linux）
        try {
          const pic = await getUserPicturesDir()
          if (pic) {
            const baseDir = pic.replace(/[\\/]+$/, '')
            const sep = baseDir.includes('\\') ? '\\' : '/'
            const dst = baseDir + sep + fname
            try {
              const buf = new Uint8Array(await file.arrayBuffer())
              try { await ensureDir(baseDir) } catch {}
              await writeFile(dst as any, buf as any)
              const needAngle = /[\s()]/.test(dst) || /^[a-zA-Z]:/.test(dst) || /\\/.test(dst)
              const mdUrl = needAngle ? `<${dst}>` : dst
              replaceUploadingPlaceholder(id, `![${fname}](${mdUrl})`)
              return
            } catch {}
          }
        } catch {}
      }
    } catch {}
    try {
      const dataUrl = await fileToDataUrl(file)
      replaceUploadingPlaceholder(id, `![${fname}](${dataUrl})`)
    } catch {}
  })()
  return Promise.resolve()
}

// 获取用户图片目录：优先使用 Tauri API，失败则基于 homeDir 猜测 Pictures
async function getUserPicturesDir(): Promise<string | null> {
  try {
    const mod: any = await import('@tauri-apps/api/path')
    if (mod && typeof mod.pictureDir === 'function') {
      const p = await mod.pictureDir()
      if (p && typeof p === 'string') return p.replace(/[\\/]+$/, '')
    }
    if (mod && typeof mod.homeDir === 'function') {
      const h = await mod.homeDir()
      if (h && typeof h === 'string') {
        const base = h.replace(/[\\/]+$/, '')
        const sep = base.includes('\\') ? '\\' : '/'
        return base + sep + 'Pictures'
      }
    }
  } catch {}
  return null
}

function startAsyncUploadFromBlob(blob: Blob, fname: string, mime: string): Promise<void> {
  const id = genUploadId()
  insertAtCursor(`![${fname || 'image'}](uploading://${id})`)
  void (async () => {
    try {
      const alwaysLocal = await getAlwaysSaveLocalImages()
      if (alwaysLocal) {
        try {
          if (isTauriRuntime() && currentFilePath) {
            const base = currentFilePath.replace(/[\\/][^\\/]*$/, '')
            const sep = base.includes('\\') ? '\\' : '/'
            const imgDir = base + sep + 'images'
            try { await ensureDir(imgDir) } catch {}
            const dst = imgDir + sep + fname
            try {
              const bytes = new Uint8Array(await blob.arrayBuffer())
              await writeFile(dst as any, bytes as any)
              const needAngle = /[\s()]/.test(dst) || /^[a-zA-Z]:/.test(dst) || /\\/.test(dst)
              const mdUrl = needAngle ? `<${dst}>` : dst
              replaceUploadingPlaceholder(id, `![${fname}](${mdUrl})`)
              return
            } catch {}
          }
        } catch {}
        try {
          if (isTauriRuntime() && !currentFilePath) {
            const dir = await getDefaultPasteDir()
            if (dir) {
              const baseDir = dir.replace(/[\\/]+$/, '')
              const sep = baseDir.includes('\\') ? '\\' : '/'
              const dst = baseDir + sep + fname
              try {
                const bytes = new Uint8Array(await blob.arrayBuffer())
                try { await ensureDir(baseDir) } catch {}
                await writeFile(dst as any, bytes as any)
                const needAngle = /[\s()]/.test(dst) || /^[a-zA-Z]:/.test(dst) || /\\/.test(dst)
                const mdUrl = needAngle ? `<${dst}>` : dst
                replaceUploadingPlaceholder(id, `![${fname}](${mdUrl})`)
                return
              } catch {}
            }
          }
        } catch {}
        try {
          const f = new File([blob], fname, { type: mime || 'application/octet-stream' })
          const dataUrl = await fileToDataUrl(f)
          replaceUploadingPlaceholder(id, `![${fname}](${dataUrl})`)
          return
        } catch {}
      }
    } catch {}
    try {
      const upCfg = await getUploaderConfig()
      if (upCfg) {
        const res = await uploadImageToS3R2(blob, fname, mime || 'application/octet-stream', upCfg)
        replaceUploadingPlaceholder(id, `![${fname}](${res.publicUrl})`)
        return
      }
    } catch {}
    try {
      const f = new File([blob], fname, { type: mime || 'application/octet-stream' })
      const dataUrl = await fileToDataUrl(f)
      replaceUploadingPlaceholder(id, `![${fname}](${dataUrl})`)
    } catch {}
  })()
  return Promise.resolve()
}
// ========= END =========

// ========== 扩展/插件：运行时与 UI ==========
async function ensurePluginsDir(): Promise<void> {
  try { await mkdir(PLUGINS_DIR as any, { baseDir: BaseDirectory.AppLocalData, recursive: true } as any) } catch {}
}

async function getHttpClient(): Promise<{ fetch?: any; Body?: any; ResponseType?: any; available?: () => Promise<boolean> } | null> {
  try {
    const mod: any = await import('@tauri-apps/plugin-http')
    const http = {
      fetch: mod?.fetch,
      Body: mod?.Body,
      ResponseType: mod?.ResponseType,
      // 标记可用：存在 fetch 即视为可用，避免因网络失败误报不可用
      available: async () => true,
    }
    if (typeof http.fetch === 'function') return http
    return null
  } catch { return null }
}

function pluginNotice(msg: string, level: 'ok' | 'err' = 'ok', ms = 1600) {
  try {
    const el = document.getElementById('status')
    if (el) {
      el.textContent = (level === 'ok' ? '✔ ' : '✖ ') + msg
      setTimeout(() => { try { el.textContent = '' } catch {} }, ms)
    }
  } catch {}
}

async function getInstalledPlugins(): Promise<Record<string, InstalledPlugin>> {
  try {
    if (!store) return {}
    const p = await store.get('plugins')
    const obj = (p && typeof p === 'object') ? (p as any) : {}
    const map = obj?.installed && typeof obj.installed === 'object' ? obj.installed : {}
    return map as Record<string, InstalledPlugin>
  } catch { return {} }
}

async function setInstalledPlugins(map: Record<string, InstalledPlugin>): Promise<void> {
  try {
    if (!store) return
    const old = (await store.get('plugins')) as any || {}
    old.installed = map
    await store.set('plugins', old)
    await store.save()
  } catch {}
}

function parseRepoInput(inputRaw: string): { type: 'github' | 'http'; manifestUrl: string; mainUrl?: string } | null {
  const input = (inputRaw || '').trim()
  if (!input) return null
  if (/^https?:\/\//i.test(input)) {
    let u = input
    if (!/manifest\.json$/i.test(u)) {
      if (!u.endsWith('/')) u += '/'
      u += 'manifest.json'
    }
    return { type: 'http', manifestUrl: u }
  }
  const m = input.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:@([A-Za-z0-9_.\/-]+))?$/)
  if (m) {
    const user = m[1], repo = m[2], branch = m[3] || 'main'
    const base = `https://raw.githubusercontent.com/${user}/${repo}/${branch}/`
    return { type: 'github', manifestUrl: base + 'manifest.json' }
  }
  return null
}

async function fetchTextSmart(url: string): Promise<string> {
  try {
    const http = await getHttpClient()
    if (http && http.fetch) {
      const resp = await http.fetch(url, { method: 'GET', responseType: http.ResponseType?.Text })
      if (resp && (resp.ok === true || (typeof resp.status === 'number' && resp.status >= 200 && resp.status < 300))) {
        const text = typeof resp.text === 'function' ? await resp.text() : (resp.data || '')
        return String(text || '')
      }
    }
  } catch {}
  const r2 = await fetch(url)
  if (!r2.ok) throw new Error(`HTTP ${r2.status}`)
  return await r2.text()
}

async function installPluginFromGit(inputRaw: string): Promise<InstalledPlugin> {
  await ensurePluginsDir()
  const parsed = parseRepoInput(inputRaw)
  if (!parsed) throw new Error('无法识别的输入，请输入 URL 或 username/repo[@branch]')
  const manifestText = await fetchTextSmart(parsed.manifestUrl)
  let manifest: PluginManifest
  try { manifest = JSON.parse(manifestText) as PluginManifest } catch { throw new Error('manifest.json 解析失败') }
  if (!manifest?.id) throw new Error('manifest.json 缺少 id')
  const mainRel = (manifest.main || 'main.js').replace(/^\/+/, '')
  const mainUrl = parsed.manifestUrl.replace(/manifest\.json$/i, '') + mainRel
  const mainCode = await fetchTextSmart(mainUrl)
  // 保存文件
  const dir = `${PLUGINS_DIR}/${manifest.id}`
  await mkdir(dir as any, { baseDir: BaseDirectory.AppLocalData, recursive: true } as any)
  await writeTextFile(`${dir}/manifest.json` as any, JSON.stringify(manifest, null, 2), { baseDir: BaseDirectory.AppLocalData } as any)
  await writeTextFile(`${dir}/${mainRel}` as any, mainCode, { baseDir: BaseDirectory.AppLocalData } as any)
  const record: InstalledPlugin = { id: manifest.id, name: manifest.name, version: manifest.version, enabled: true, dir, main: mainRel, description: manifest.description }
  const map = await getInstalledPlugins()
  map[manifest.id] = record
  await setInstalledPlugins(map)
  return record
}

async function readPluginMainCode(p: InstalledPlugin): Promise<string> {
  const path = `${p.dir}/${p.main || 'main.js'}`
  return await readTextFile(path as any, { baseDir: BaseDirectory.AppLocalData } as any)
}

async function activatePlugin(p: InstalledPlugin): Promise<void> {
  if (activePlugins.has(p.id)) return
  const code = await readPluginMainCode(p)
  const dataUrl = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(code)
  const mod: any = await import(/* @vite-ignore */ dataUrl)
  const http = await getHttpClient()
  const ctx = {
    http,
    invoke,
    storage: {
      get: async (key: string) => {
        try { if (!store) return null; const all = (await store.get('plugin:' + p.id)) as any || {}; return all[key] } catch { return null }
      },
      set: async (key: string, value: any) => { try { if (!store) return; const all = (await store.get('plugin:' + p.id)) as any || {}; all[key] = value; await store.set('plugin:' + p.id, all); await store.save() } catch {} }
    },
    addMenuItem: (opt: { label: string; title?: string; onClick?: () => void }) => {
      try {
        const bar = document.querySelector('.menubar') as HTMLDivElement | null
        if (!bar) return () => {}
        if (pluginMenuAdded.get(p.id)) return () => {}
        pluginMenuAdded.set(p.id, true)
        const el = document.createElement('div')
        el.className = 'menu-item'
        el.textContent = (p.id === 'typecho-publisher-flymd') ? '发布' : (opt.label || '扩展')
        if (opt.title) el.title = opt.title
        el.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); try { opt.onClick && opt.onClick() } catch (e) { console.error(e) } })
        bar.appendChild(el)
        return () => { try { el.remove() } catch {} }
      } catch { return () => {} }
    },
    ui: {
      notice: (msg: string, level?: 'ok' | 'err', ms?: number) => pluginNotice(msg, level, ms),
      confirm: async (message: string) => { try { return await confirmNative(message, '确认') } catch { return false } }
    },
    getEditorValue: () => editor.value,
    setEditorValue: (v: string) => { try { editor.value = v; dirty = true; refreshTitle(); refreshStatus(); if (mode === 'preview') { void renderPreview() } else if (wysiwyg) { scheduleWysiwygRender() } } catch {} },
  }
  if (typeof mod?.activate === 'function') {
    await mod.activate(ctx)
  }
  activePlugins.set(p.id, mod)
}

async function deactivatePlugin(id: string): Promise<void> {
  const mod = activePlugins.get(id)
  if (!mod) return
  try { if (typeof mod?.deactivate === 'function') await mod.deactivate() } catch {}
  activePlugins.delete(id)
  try { pluginMenuAdded.delete(id) } catch {}
}

async function refreshExtensionsUI(): Promise<void> {
  if (!_extListHost) return
  const host = _extListHost
  host.innerHTML = ''
  // Builtins
  const builtinsEl = document.createElement('div')
  builtinsEl.className = 'ext-section'
  const st1 = document.createElement('div'); st1.className = 'ext-subtitle'; st1.textContent = '内置扩展'
  builtinsEl.appendChild(st1)
  const list1 = document.createElement('div'); list1.className = 'ext-list'
  builtinsEl.appendChild(list1)
  for (const b of builtinPlugins) {
    const row = document.createElement('div'); row.className = 'ext-item'
    const meta = document.createElement('div'); meta.className = 'ext-meta'
    const name = document.createElement('div'); name.className = 'ext-name'; name.textContent = `${b.name} (${b.version})`
    const desc = document.createElement('div'); desc.className = 'ext-desc'; desc.textContent = b.description || ''
    meta.appendChild(name); meta.appendChild(desc)
    const actions = document.createElement('div'); actions.className = 'ext-actions'
    const btnEnable = document.createElement('button'); btnEnable.className = 'btn'
    const upCfg = await getUploaderConfig().catch(() => null)
    const enabled = !!upCfg
    btnEnable.textContent = enabled ? '已开启' : '开启'
    btnEnable.addEventListener('click', async () => {
      try {
        const cur = await getUploaderConfig().catch(() => null)
        const next = cur ? null : { enabled: true, accessKeyId: '', secretAccessKey: '', bucket: '', region: 'auto', endpoint: '', forcePathStyle: true, aclPublicRead: true, keyTemplate: '{year}/{month}{fileName}{md5}.{extName}' } as any
        if (store) {
          if (next) { await store.set('uploader', next) } else { await store.set('uploader', null) }
          await store.save()
        }
        await refreshExtensionsUI()
        pluginNotice('已更新图床开关', 'ok', 1200)
      } catch (e) { showError('更新图床开关失败', e) }
    })
    const btnSettings = document.createElement('button'); btnSettings.className = 'btn primary'; btnSettings.textContent = '设置'
    // 打开内置图床设置对话框
    btnSettings.addEventListener('click', () => { try { void openUploaderDialog() } catch {} })
    actions.appendChild(btnEnable); actions.appendChild(btnSettings)
    row.appendChild(meta); row.appendChild(actions)
    list1.appendChild(row)
  }
  host.appendChild(builtinsEl)

  // Installed
  const st2wrap = document.createElement('div'); st2wrap.className = 'ext-section'
  const st2 = document.createElement('div'); st2.className = 'ext-subtitle'; st2.textContent = '已安装扩展'
  st2wrap.appendChild(st2)
  const list2 = document.createElement('div'); list2.className = 'ext-list'
  st2wrap.appendChild(list2)
  const map = await getInstalledPlugins()
  const arr = Object.values(map)
  if (arr.length === 0) {
    const empty = document.createElement('div'); empty.className = 'ext-empty'; empty.textContent = '暂无安装的扩展'
    st2wrap.appendChild(empty)
  } else {
  for (const p of arr) {
      const row = document.createElement('div'); row.className = 'ext-item'
      const meta = document.createElement('div'); meta.className = 'ext-meta'
      const name = document.createElement('div'); name.className = 'ext-name'; name.textContent = `${p.name || p.id} ${p.version ? '(' + p.version + ')' : ''}`
      const desc = document.createElement('div'); desc.className = 'ext-desc'; desc.textContent = p.description || p.dir
      meta.appendChild(name); meta.appendChild(desc)
      const actions = document.createElement('div'); actions.className = 'ext-actions'
      if (p.enabled) {
        const btnSet = document.createElement('button'); btnSet.className = 'btn'; btnSet.textContent = '设置'
        btnSet.addEventListener('click', async () => {
          try {
            const mod = activePlugins.get(p.id)
            const http = await getHttpClient()
            const ctx = {
              http,
              invoke,
              storage: {
                get: async (key: string) => { try { if (!store) return null; const all = (await store.get('plugin:' + p.id)) as any || {}; return all[key] } catch { return null } },
                set: async (key: string, value: any) => { try { if (!store) return; const all = (await store.get('plugin:' + p.id)) as any || {}; all[key] = value; await store.set('plugin:' + p.id, all); await store.save() } catch {} }
              },
              ui: { notice: (msg: string, level?: 'ok' | 'err', ms?: number) => pluginNotice(msg, level, ms), confirm: async (m: string) => { try { return await confirmNative(m) } catch { return false } } },
              getEditorValue: () => editor.value,
              setEditorValue: (v: string) => { try { editor.value = v; dirty = true; refreshTitle(); refreshStatus(); if (mode === 'preview') { void renderPreview() } else if (wysiwyg) { scheduleWysiwygRender() } } catch {} },
            }
            if (mod && typeof mod.openSettings === 'function') { await mod.openSettings(ctx) }
            else pluginNotice('该扩展未提供设置', 'err', 1600)
          } catch (e) { showError('打开扩展设置失败', e) }
        })
        actions.appendChild(btnSet)
      }
      const btnToggle = document.createElement('button'); btnToggle.className = 'btn'; btnToggle.textContent = p.enabled ? '禁用' : '启用'
      btnToggle.addEventListener('click', async () => {
        try { p.enabled = !p.enabled; map[p.id] = p; await setInstalledPlugins(map); if (p.enabled) await activatePlugin(p); else await deactivatePlugin(p.id); await refreshExtensionsUI() } catch (e) { showError('切换扩展失败', e) }
      })
      const btnRemove = document.createElement('button'); btnRemove.className = 'btn warn'; btnRemove.textContent = '移除'
      btnRemove.addEventListener('click', async () => {
        const ok = await confirmNative(`确定移除扩展 ${p.name || p.id} ？`)
        if (!ok) return
        try {
          await deactivatePlugin(p.id)
          await removeDirRecursive(p.dir)
          delete map[p.id]; await setInstalledPlugins(map)
          await refreshExtensionsUI(); pluginNotice('已移除扩展', 'ok', 1200)
        } catch (e) { showError('移除扩展失败', e) }
      })
      actions.appendChild(btnToggle)
      actions.appendChild(btnRemove)
      row.appendChild(meta); row.appendChild(actions)
      list2.appendChild(row)
    }
  }
  host.appendChild(st2wrap)
}

async function removeDirRecursive(dir: string): Promise<void> {
  try {
    const entries = await readDir(dir as any, { baseDir: BaseDirectory.AppLocalData } as any)
    for (const e of entries as any[]) {
      if (e.isDir) { await removeDirRecursive(`${dir}/${e.name}`) }
      else { try { await remove(`${dir}/${e.name}` as any, { baseDir: BaseDirectory.AppLocalData } as any) } catch {} }
    }
    try { await remove(dir as any, { baseDir: BaseDirectory.AppLocalData } as any) } catch {}
  } catch {}
}

function ensureExtensionsOverlayMounted() {
  if (_extOverlayEl) return
  const overlay = document.createElement('div')
  overlay.className = 'ext-overlay'
  overlay.id = 'extensions-overlay'
  overlay.innerHTML = `
    <div class=\"ext-dialog\" role=\"dialog\" aria-modal=\"true\">
      <div class=\"ext-header\">
        <div>扩展与插件管理</div>
        <button class=\"ext-close\" id=\"ext-close\">×</button>
      </div>
      <div class=\"ext-body\">
        <div class=\"ext-section\">
          <div class=\"ext-subtitle\">安装扩展（GitHub 或 URL）</div>
          <div class=\"ext-install\">
            <input type=\"text\" id=\"ext-install-input\" placeholder=\"输入 URL 或 username/repository@branch（branch 可省略）\">
            <button class=\"primary\" id=\"ext-install-btn\">安装</button>
          </div>
        </div>
        <div class=\"ext-section\" id=\"ext-list-host\"></div>
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  _extOverlayEl = overlay
  _extListHost = overlay.querySelector('#ext-list-host') as HTMLDivElement | null
  _extInstallInput = overlay.querySelector('#ext-install-input') as HTMLInputElement | null
  const btnClose = overlay.querySelector('#ext-close') as HTMLButtonElement | null
  const btnInstall = overlay.querySelector('#ext-install-btn') as HTMLButtonElement | null
  btnClose?.addEventListener('click', () => showExtensionsOverlay(false))
  overlay.addEventListener('click', (e) => { if (e.target === overlay) showExtensionsOverlay(false) })
  btnInstall?.addEventListener('click', async () => {
    const v = (_extInstallInput?.value || '').trim()
    if (!v) return
    try {
      const rec = await installPluginFromGit(v)
      await activatePlugin(rec)
      _extInstallInput!.value = ''
      await refreshExtensionsUI()
      pluginNotice('安装成功', 'ok', 1500)
    } catch (e) {
      showError('安装扩展失败', e)
    }
  })
}

async function showExtensionsOverlay(show: boolean): Promise<void> {
  ensureExtensionsOverlayMounted()
  if (!_extOverlayEl) return
  if (show) {
    _extOverlayEl.classList.add('show')
    await refreshExtensionsUI()
  } else {
    _extOverlayEl.classList.remove('show')
  }
}

async function loadAndActivateEnabledPlugins(): Promise<void> {
  try {
    const map = await getInstalledPlugins()
    const toEnable = Object.values(map).filter((p) => p.enabled)
    for (const p of toEnable) {
      try { await activatePlugin(p) } catch (e) { console.warn('插件激活失败', p.id, e) }
    }
  } catch {}
}
