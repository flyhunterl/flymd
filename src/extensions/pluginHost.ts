// 插件宿主：负责插件激活/停用与运行时上下文
// 从 main.ts 拆分，保持对外行为不变，避免 main.ts 继续膨胀

import {
  readTextFile,
  readFile,
  readDir,
  remove,
  writeFile,
  mkdir,
  writeTextFile,
  BaseDirectory,
  exists,
  stat,
} from '@tauri-apps/plugin-fs'
import { save, open } from '@tauri-apps/plugin-dialog'
import type { Store } from '@tauri-apps/plugin-store'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { appLocalDataDir } from '@tauri-apps/api/path'
import { getHttpClient } from './runtime'
import type { InstalledPlugin } from './runtime'
import type {
  PluginContextMenuItem,
  ContextMenuItemConfig,
} from '../ui/contextMenus'
import { initPluginsMenu, addToPluginsMenu, removeFromPluginsMenu, togglePluginDropdown } from './pluginMenu'
import { NotificationManager } from '../core/uiNotifications'
import type { NotificationType } from '../core/uiNotifications'
import { t } from '../i18n'

// 选择变化监听
type PluginSelectionHandler = (sel: {
  start: number
  end: number
  text: string
}) => void

// Panel 布局
export type PluginDockSide = 'left' | 'right' | 'bottom'
export type PluginDockPanelState = {
  pluginId: string
  panelId: string
  side: PluginDockSide
  size: number
  visible: boolean
}
export type PluginDockPanelHandle = {
  setVisible: (visible: boolean) => void
  setSide: (side: PluginDockSide) => void
  setSize: (size: number) => void
  update: (opt: {
    side?: PluginDockSide
    size?: number
    visible?: boolean
  }) => void
  dispose: () => void
}

type PluginAPIRecord = { pluginId: string; api: any }

export type PluginHostState = {
  activePlugins: Map<string, any>
  pluginMenuAdded: Map<string, boolean>
  pluginMenuDisposers: Map<string, Array<() => void>>
  pluginAPIRegistry: Map<string, PluginAPIRecord>
  pluginContextMenuItems: PluginContextMenuItem[]
  pluginSelectionHandlers: Map<string, PluginSelectionHandler>
  pluginDockPanels: Map<string, PluginDockPanelState>
}

export type PluginHostDeps = {
  // 全局存储
  getStore: () => Store | null
  // 编辑器 / 预览
  getEditor: () => HTMLTextAreaElement | null
  getPreviewRoot: () => HTMLDivElement | null
  getCurrentFilePath: () => string | null
  getLibraryRoot: () => Promise<string | null>
  isPreviewMode: () => boolean
  isWysiwyg: () => boolean
  renderPreview: () => void | Promise<void>
  scheduleWysiwygRender: () => void
  markDirtyAndRefresh: () => void
  // 文档结构
  splitYamlFrontMatter: (
    raw: string,
  ) => { frontMatter: string | null; body: string }
  yamlLoad: (raw: string) => any
  // 通知与确认
  pluginNotice: (msg: string, level?: 'ok' | 'err', ms?: number) => void
  confirmNative: (message: string, title?: string) => Promise<boolean>
  // 业务能力
  exportCurrentDocToPdf: (target: string) => Promise<void>
  openFileByPath: (path: string) => Promise<void>
  createStickyNote: (filePath: string) => Promise<void>
  // 布局刷新
  updatePluginDockGaps: () => void
}

export type PluginHost = {
  activatePlugin: (p: InstalledPlugin) => Promise<void>
  deactivatePlugin: (id: string) => Promise<void>
  getActivePluginModule: (id: string) => any
  getPluginAPI: (namespace: string) => any | null
  getContextMenuItems: () => PluginContextMenuItem[]
  openPluginSettings: (p: InstalledPlugin) => Promise<void>
}

let _appLocalDataDirCached: string | null | undefined

async function getAppLocalDataDirCached(): Promise<string | null> {
  if (typeof _appLocalDataDirCached !== 'undefined') return _appLocalDataDirCached
  try {
    const dir = await appLocalDataDir()
    if (dir && typeof dir === 'string') {
      _appLocalDataDirCached = dir.replace(/[\\/]+$/, '')
      return _appLocalDataDirCached
    }
  } catch {}
  _appLocalDataDirCached = null
  return _appLocalDataDirCached
}

async function resolvePluginInstallAbsolute(dir: string): Promise<string | null> {
  try {
    const base = await getAppLocalDataDirCached()
    if (!base) return null
    const sep = base.includes('\\') ? '\\' : '/'
    const cleaned = String(dir || '')
      .replace(/^[/\\]+/, '')
      .replace(/[\\/]+/g, '/')
    if (!cleaned) return base
    return base + sep + cleaned.replace(/\//g, sep)
  } catch {
    return null
  }
}

function toPluginAssetUrl(absDir: string | null, relPath: string): string {
  try {
    if (!absDir) return ''
    let rel = String(relPath || '').trim()
    if (!rel) return ''
    rel = rel.replace(/^[/\\]+/, '').replace(/[\\/]+/g, '/')
    const sep = absDir.includes('\\') ? '\\' : '/'
    const abs = absDir + sep + rel.replace(/\//g, sep)
    return typeof convertFileSrc === 'function' ? convertFileSrc(abs) : abs
  } catch {
    return ''
  }
}

function pathSep(p: string): string {
  return p.includes('\\') ? '\\' : '/'
}

function joinPath(base: string, child: string): string {
  const s = pathSep(base)
  return (base.endsWith(s) ? base : base + s) + child
}

function normalizeRelative(base: string, target: string): string {
  const baseNorm = String(base || '').replace(/[\\/]+$/, '')
  const sep = pathSep(baseNorm)
  let rel = String(target || '')
  if (rel.toLowerCase().startsWith(baseNorm.toLowerCase())) {
    rel = rel.slice(baseNorm.length)
  }
  if (rel.startsWith(sep)) rel = rel.slice(1)
  return rel.replace(/\\/g, '/')
}

function toMtimeMs(meta: any): number {
  try {
    const cands = [
      meta?.modifiedAt,
      meta?.modifiedTime,
      meta?.mtimeMs,
      meta?.mtime,
      meta?.modificationTime,
      meta?.st_mtime_ms,
      meta?.st_mtime,
      meta?.changedAt,
      meta?.ctimeMs,
      meta?.ctime,
    ]
    for (const v of cands) {
      if (v == null) continue
      if (typeof v === 'number' && Number.isFinite(v)) return v
      if (typeof v === 'string') {
        const t = Date.parse(v)
        if (Number.isFinite(t)) return t
      }
      try {
        if (v instanceof Date) {
          const t = (v as Date).getTime()
          if (Number.isFinite(t)) return t
        }
      } catch {}
    }
  } catch {}
  return 0
}

async function readPluginMainCode(p: InstalledPlugin): Promise<string> {
  const path = `${p.dir}/${p.main || 'main.js'}`
  return await readTextFile(path as any, {
    baseDir: BaseDirectory.AppLocalData,
  } as any)
}

export function createPluginHost(
  deps: PluginHostDeps,
  state: PluginHostState,
): PluginHost {
  async function activatePlugin(p: InstalledPlugin): Promise<void> {
    if (state.activePlugins.has(p.id)) return
    const code = await readPluginMainCode(p)
    const dataUrl =
      'data:text/javascript;charset=utf-8,' + encodeURIComponent(code)
    const mod: any = await import(/* @vite-ignore */ dataUrl)
    const http = await getHttpClient()
    const pluginAssetsAbs = await resolvePluginInstallAbsolute(p.dir)

    async function openAiWindow() {
      try {
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
        const label =
          'ai-assistant-' + Math.random().toString(36).slice(2, 8)
        // 独立 AI 窗口，仅供 AI 助手插件使用
        // 这里完全保持原有行为
        // eslint-disable-next-line no-new
        new WebviewWindow(label, {
          url: 'index.html#ai-assistant',
          width: 860,
          height: 640,
          title: 'AI 助手',
        })
      } catch (e) {
        console.error('openAiWindow 失败', e)
      }
    }

    const getSourceTextForPlugin = () => {
      try {
        const ed = deps.getEditor()
        return String(ed?.value || '')
      } catch {
        return ''
      }
    }

    const htmlToMarkdownForPlugin = async (
      html: string,
      opts?: { baseUrl?: string },
    ): Promise<string> => {
      try {
        const raw = String(html || '')
        if (!raw.trim()) return ''
        const mod2: any = await import('../html2md')
        const fn = (mod2 && (mod2.htmlToMarkdown || mod2.default)) as unknown
        if (typeof fn !== 'function') {
          console.warn(
            `[Plugin ${p.id}] htmlToMarkdown: 内部转换函数不可用`,
          )
          return ''
        }
        return await (fn as (h: string, o?: any) => string)(raw, opts || {})
      } catch (e) {
        console.error(`[Plugin ${p.id}] htmlToMarkdown 失败:`, e)
        return ''
      }
    }

    const getFrontMatterForPlugin = () => {
      try {
        const src = getSourceTextForPlugin()
        const r = deps.splitYamlFrontMatter(src)
        return r.frontMatter
      } catch {
        return null
      }
    }

    const getDocBodyForPlugin = () => {
      try {
        const src = getSourceTextForPlugin()
        const r = deps.splitYamlFrontMatter(src)
        return r.body
      } catch {
        return getSourceTextForPlugin()
      }
    }

    const getDocMetaForPlugin = (): any | null => {
      try {
        const fm = getFrontMatterForPlugin()
        if (!fm) return null
        let s = String(fm)
        s = s.replace(/^\uFEFF?---\s*\r?\n?/, '')
        s = s.replace(/\r?\n---\s*$/, '')
        const doc = deps.yamlLoad(s)
        if (!doc || typeof doc !== 'object') return null
        return doc
      } catch {
        return null
      }
    }

    const getSourceSelectionForPlugin = () => {
      try {
        const ed = deps.getEditor()
        if (!ed) return { start: 0, end: 0, text: '' }
        const s = ed.selectionStart >>> 0
        const e = ed.selectionEnd >>> 0
        const a = Math.min(s, e)
        const b = Math.max(s, e)
        const text = getSourceTextForPlugin().slice(a, b)
        return { start: a, end: b, text }
      } catch {
        return { start: 0, end: 0, text: '' }
      }
    }

    const getLineTextForPlugin = (lineNumber: number): string => {
      try {
        const n = Number(lineNumber)
        if (!Number.isFinite(n)) return ''
        const idx = Math.max(1, Math.floor(n)) - 1
        const lines = getSourceTextForPlugin().split(/\r?\n/)
        if (idx < 0 || idx >= lines.length) return ''
        return lines[idx]
      } catch {
        return ''
      }
    }

    const notifySelectionChangeForPlugins = () => {
      try {
        const sel = getSourceSelectionForPlugin()
        for (const fn of state.pluginSelectionHandlers.values()) {
          if (typeof fn === 'function') {
            try {
              fn(sel)
            } catch (e) {
              console.error('[Plugin] onSelectionChange 失败', e)
            }
          }
        }
      } catch {}
    }

    const ctx = {
      http,
      htmlToMarkdown: (html: string, opts?: { baseUrl?: string }) =>
        htmlToMarkdownForPlugin(html, opts),
      invoke,
      openAiWindow,
      getAssetUrl: (relPath: string) =>
        toPluginAssetUrl(pluginAssetsAbs, relPath),
      layout: {
        registerPanel: (
          panelId: string,
          opt: { side: PluginDockSide; size: number; visible?: boolean },
        ): PluginDockPanelHandle => {
          try {
            const id = String(panelId || 'default')
            const key = `${p.id}::${id}`
            const side: PluginDockSide = (opt && opt.side) || 'left'
            const size = Math.max(0, Number(opt && opt.size) || 0)
            const visible = !!(
              opt && (typeof opt.visible === 'boolean' ? opt.visible : true)
            )
            const stateItem: PluginDockPanelState = {
              pluginId: p.id,
              panelId: id,
              side,
              size,
              visible,
            }
            state.pluginDockPanels.set(key, stateItem)
            deps.updatePluginDockGaps()
            const handle: PluginDockPanelHandle = {
              setVisible(v: boolean) {
                const cur = state.pluginDockPanels.get(key)
                if (!cur) return
                cur.visible = !!v
                state.pluginDockPanels.set(key, cur)
                deps.updatePluginDockGaps()
              },
              setSide(s: PluginDockSide) {
                const cur = state.pluginDockPanels.get(key)
                if (!cur) return
                cur.side = s
                state.pluginDockPanels.set(key, cur)
                deps.updatePluginDockGaps()
              },
              setSize(sz: number) {
                const cur = state.pluginDockPanels.get(key)
                if (!cur) return
                cur.size = Math.max(0, Number(sz) || 0)
                state.pluginDockPanels.set(key, cur)
                deps.updatePluginDockGaps()
              },
              update(opt2: {
                side?: PluginDockSide
                size?: number
                visible?: boolean
              }) {
                const cur = state.pluginDockPanels.get(key)
                if (!cur) return
                if (opt2.side) cur.side = opt2.side
                if (typeof opt2.size === 'number') {
                  cur.size = Math.max(0, Number(opt2.size) || 0)
                }
                if (typeof opt2.visible === 'boolean') {
                  cur.visible = opt2.visible
                }
                state.pluginDockPanels.set(key, cur)
                deps.updatePluginDockGaps()
              },
              dispose() {
                state.pluginDockPanels.delete(key)
                deps.updatePluginDockGaps()
              },
            }
            return handle
          } catch {
            const noop: PluginDockPanelHandle = {
              setVisible: () => {},
              setSide: () => {},
              setSize: () => {},
              update: () => {},
              dispose: () => {},
            }
            return noop
          }
        },
      },
      storage: {
        get: async (key: string) => {
          try {
            const store = deps.getStore()
            if (!store) return null
            const all =
              ((await store.get('plugin:' + p.id)) as any) || {}
            return all[key]
          } catch {
            return null
          }
        },
        set: async (key: string, value: any) => {
          try {
            const store = deps.getStore()
            if (!store) return
            const all =
              ((await store.get('plugin:' + p.id)) as any) || {}
            all[key] = value
            await store.set('plugin:' + p.id, all)
            await store.save()
          } catch {}
        },
      },
      addMenuItem: (opt: {
        label: string
        title?: string
        onClick?: () => void
        children?: any[]
      }) => {
        try {
          if (state.pluginMenuAdded.get(p.id)) return () => {}
          state.pluginMenuAdded.set(p.id, true)

          // 独立显示：添加到菜单栏
          if (p.showInMenuBar) {
            const bar = document.querySelector(
              '.menubar',
            ) as HTMLDivElement | null
            if (!bar) return () => {}

            const el = document.createElement('div')
            el.className = 'menu-item'
            el.textContent =
              p.id === 'typecho-publisher-flymd'
                ? '发布'
                : opt.label || '扩展'
            if (opt.title) el.title = opt.title

            if (opt.children && opt.children.length > 0) {
              el.addEventListener('click', (ev) => {
                ev.preventDefault()
                ev.stopPropagation()
                try {
                  togglePluginDropdown(el, opt.children || [])
                } catch (e) {
                  console.error(e)
                }
              })
            } else {
              el.addEventListener('click', (ev) => {
                ev.preventDefault()
                ev.stopPropagation()
                try {
                  opt.onClick && opt.onClick()
                } catch (e) {
                  console.error(e)
                }
              })
            }

            bar.appendChild(el)
            const disposer = () => {
              try {
                el.remove()
              } catch {}
            }
            const list = state.pluginMenuDisposers.get(p.id) || []
            list.push(disposer)
            state.pluginMenuDisposers.set(p.id, list)
            return disposer
          }

          // 收纳到“插件”菜单
          addToPluginsMenu(p.id, {
            label: opt.label || '扩展',
            onClick: opt.onClick,
            children: opt.children,
          })
          const disposer = () => {
            removeFromPluginsMenu(p.id)
          }
          const list = state.pluginMenuDisposers.get(p.id) || []
          list.push(disposer)
          state.pluginMenuDisposers.set(p.id, list)
          return disposer
        } catch {
          return () => {}
        }
      },
      ui: {
        notice: (
          msg: string,
          level?: 'ok' | 'err',
          ms?: number,
        ) => deps.pluginNotice(msg, level, ms),
        showNotification: (
          message: string,
          options?: {
            type?: 'success' | 'error' | 'info'
            duration?: number
            onClick?: () => void
          },
        ) => {
          try {
            const opt = options || {}
            let notifType: NotificationType = 'plugin-success'
            if (opt.type === 'error') notifType = 'plugin-error'
            else if (opt.type === 'info') notifType = 'extension'
            else notifType = 'plugin-success'
            return NotificationManager.show(
              notifType,
              message,
              opt.duration,
              opt.onClick,
            )
          } catch (err) {
            console.error('[Plugin] showNotification 失败', err)
            return ''
          }
        },
        hideNotification: (id: string) => {
          try {
            NotificationManager.hide(id)
          } catch (err) {
            console.error('[Plugin] hideNotification 失败', err)
          }
        },
        confirm: async (m: string) => {
          try {
            return await deps.confirmNative(m, '确认')
          } catch {
            return false
          }
        },
      },
      getCurrentFilePath: () => deps.getCurrentFilePath(),
      getLibraryRoot: () => deps.getLibraryRoot(),
      getEditorValue: () => getSourceTextForPlugin(),
      setEditorValue: (v: string) => {
        try {
          const ed = deps.getEditor()
          if (!ed) return
          ed.value = v
          deps.markDirtyAndRefresh()
          if (deps.isPreviewMode()) {
            void deps.renderPreview()
          } else if (deps.isWysiwyg()) {
            deps.scheduleWysiwygRender()
          }
        } catch {}
      },
      getSelection: () => getSourceSelectionForPlugin(),
      getSelectedMarkdown: () => getSourceSelectionForPlugin().text,
      getSourceText: () => getSourceTextForPlugin(),
      getFrontMatterRaw: () => getFrontMatterForPlugin(),
      getDocBody: () => getDocBodyForPlugin(),
      getDocMeta: () => getDocMetaForPlugin(),
      getLineText: (lineNumber: number) => getLineTextForPlugin(lineNumber),
      replaceRange: (start: number, end: number, text: string) => {
        try {
          const ed = deps.getEditor()
          if (!ed) return
          const v = String(ed.value || '')
          const a = Math.max(0, Math.min(start >>> 0, end >>> 0))
          const b = Math.max(start >>> 0, end >>> 0)
          ed.value =
            v.slice(0, a) + String(text || '') + v.slice(b)
          const caret = a + String(text || '').length
          ed.selectionStart = caret
          ed.selectionEnd = caret
          deps.markDirtyAndRefresh()
          if (deps.isPreviewMode()) {
            void deps.renderPreview()
          } else if (deps.isWysiwyg()) {
            deps.scheduleWysiwygRender()
          }
        } catch {}
      },
      insertAtCursor: (text: string) => {
        try {
          const ed = deps.getEditor()
          if (!ed) return
          const s = ed.selectionStart >>> 0
          const e = ed.selectionEnd >>> 0
          const a = Math.min(s, e)
          const b = Math.max(s, e)
          const v = String(ed.value || '')
          ed.value =
            v.slice(0, a) + String(text || '') + v.slice(b)
          const caret = a + String(text || '').length
          ed.selectionStart = caret
          ed.selectionEnd = caret
          deps.markDirtyAndRefresh()
          if (deps.isPreviewMode()) {
            void deps.renderPreview()
          } else if (deps.isWysiwyg()) {
            deps.scheduleWysiwygRender()
          }
        } catch {}
      },
      readTextFile: async (absPath: string) => {
        try {
          const p2 = String(absPath || '').trim()
          if (!p2) {
            throw new Error('absPath 不能为空')
          }
          return await readTextFile(p2 as any)
        } catch (e) {
          console.error(`[Plugin ${p.id}] readTextFile 失败:`, e)
          throw e
        }
      },
      writeTextFile: async (absPath: string, content: string) => {
        try {
          const p2 = String(absPath || '').trim()
          if (!p2) {
            throw new Error('absPath 不能为空')
          }
          await writeTextFile(p2 as any, String(content ?? ''), {} as any)
        } catch (e) {
          console.error(`[Plugin ${p.id}] writeTextFile 失败:`, e)
          throw e
        }
      },
      listLibraryFiles: async (opt?: {
        extensions?: string[]
        maxDepth?: number
      }) => {
        const root = await deps.getLibraryRoot()
        if (!root) {
          throw new Error('当前未打开任何库')
        }
        const base = String(root).replace(/[\\/]+$/, '')
        const allow = new Set(
          (opt?.extensions || ['md', 'markdown']).map((x) =>
            String(x || '').replace(/^\./, '').toLowerCase(),
          ),
        )
        const maxDepth =
          Number.isFinite(opt?.maxDepth) && opt?.maxDepth !== undefined
            ? Math.max(0, Number(opt?.maxDepth))
            : 32
        const out: Array<{
          path: string
          relative: string
          name: string
          mtime?: number
        }> = []

        const walk = async (dir: string, depth: number) => {
          if (depth < 0) return
          let entries: any[] = []
          try {
            entries = (await readDir(dir, {
              recursive: false,
            } as any)) as any[]
          } catch {
            entries = []
          }
          for (const it of entries || []) {
            const name = String((it as any)?.name || '').trim()
            const full: string =
              typeof (it as any)?.path === 'string' && (it as any)?.path
                ? (it as any)?.path
                : joinPath(dir, name || '')
            let isDir: boolean =
              (it as any)?.isDirectory !== undefined
                ? !!(it as any)?.isDirectory
                : false
            if ((it as any)?.isDirectory === undefined) {
              try {
                const st = (await stat(full as any)) as any
                isDir = !!st?.isDirectory
              } catch {
                isDir = false
              }
            }
            if (isDir) {
              await walk(full, depth - 1)
              continue
            }
            const nm =
              name || (full.split(/[\\/]+/).pop() as string) || full
            const ext = (nm.split('.').pop() || '').toLowerCase()
            if (allow.size > 0 && !allow.has(ext)) continue
            const rel = normalizeRelative(base, full)
            const meta = (it as any)?.metadata
            out.push({
              path: full,
              relative: rel,
              name: nm,
              mtime: toMtimeMs(meta),
            })
          }
        }

        await walk(base, maxDepth)
        out.sort((a, b) =>
          a.relative.localeCompare(b.relative, 'en', {
            sensitivity: 'base',
          }),
        )
        return out
      },
      readFileBinary: async (absPath: string) => {
        try {
          const p2 = String(absPath || '').trim()
          if (!p2) {
            throw new Error('absPath 不能为空')
          }
          const bytes = await readFile(p2 as any)
          if (bytes instanceof Uint8Array) return bytes
          if (Array.isArray(bytes)) return new Uint8Array(bytes as any)
          if ((bytes as any)?.buffer instanceof ArrayBuffer) {
            return new Uint8Array((bytes as any).buffer)
          }
          throw new Error('无法解析文件字节数据')
        } catch (e) {
          console.error(
            `[Plugin ${p.id}] readFileBinary 失败:`,
            e,
          )
          throw e
        }
      },
      openFileByPath: async (path: string) => {
        try {
          await deps.openFileByPath(path)
        } catch (e) {
          console.error('plugin openFileByPath 失败', e)
          throw e
        }
      },
      createStickyNote: async (filePath: string) => {
        try {
          await deps.createStickyNote(filePath)
        } catch (e) {
          console.error('plugin createStickyNote 失败', e)
          throw e
        }
      },
      exportCurrentToPdf: async (target: string) => {
        try {
          await deps.exportCurrentDocToPdf(target)
        } catch (e) {
          console.error('plugin exportCurrentToPdf 失败', e)
          throw e
        }
      },
      // 下载远程文件到当前文档所在目录（或库根目录）
      // 返回 { fullPath, relativePath }，relativePath 适合作为当前文档中的相对引用
      downloadFileToCurrentFolder: async (opt: {
        url: string
        fileName?: string
        subDir?: string
        onConflict?: 'overwrite' | 'renameAuto' | 'error'
      }): Promise<{ fullPath: string; relativePath: string }> => {
        try {
          const urlRaw = (opt && opt.url ? String(opt.url) : '').trim()
          if (!urlRaw) {
            throw new Error('url 不能为空')
          }

          if (!http || typeof http.fetch !== 'function') {
            throw new Error('当前环境不支持下载文件')
          }

          const resp = await http.fetch(urlRaw, {
            method: 'GET',
            responseType: http.ResponseType?.Binary,
          })

          if (
            !resp ||
            !(
              resp.ok === true ||
              (typeof resp.status === 'number' &&
                resp.status >= 200 &&
                resp.status < 300)
            )
          ) {
            const status =
              resp && typeof resp.status === 'number'
                ? resp.status
                : '未知'
            throw new Error(`下载失败（HTTP ${status}）`)
          }

          let data: Uint8Array
          if (resp.data instanceof Uint8Array) {
            data = resp.data
          } else if (Array.isArray(resp.data)) {
            data = new Uint8Array(resp.data as any)
          } else if (resp.arrayBuffer) {
            const buf = await resp.arrayBuffer()
            data = buf ? new Uint8Array(buf) : new Uint8Array()
          } else if (resp.data && typeof resp.data === 'string') {
            const bin = resp.data as string
            const arr = new Uint8Array(bin.length)
            for (let i = 0; i < bin.length; i++) {
              arr[i] = bin.charCodeAt(i) & 0xff
            }
            data = arr
          } else {
            throw new Error('下载响应为空')
          }

          const root = await deps.getLibraryRoot()
          if (!root) {
            throw new Error('当前未打开任何库')
          }
          const rootNorm = String(root).replace(/[\\/]+$/, '')
          const current = deps.getCurrentFilePath()

          // 优先使用当前文件所在目录；否则退回库根目录
          let baseDir = rootNorm
          if (current && current.startsWith(rootNorm)) {
            baseDir = current.replace(/[\\/][^\\/]*$/, '')
          }

          const sep = baseDir.includes('\\') ? '\\' : '/'

          // 可选的子目录（例如 images），用于将资源统一归档在当前文档目录下的固定文件夹中
          let targetDir = baseDir
          let relDirForMd = ''
          const subDirRaw =
            opt && typeof opt.subDir === 'string'
              ? opt.subDir.trim()
              : ''
          if (subDirRaw) {
            const cleanSub = subDirRaw
              .replace(/[\\]+/g, '/')
              .replace(/^\/+|\/+$/g, '')
            if (cleanSub) {
              targetDir =
                baseDir + sep + cleanSub.replace(/\//g, sep)
              relDirForMd = cleanSub
            }
          }

          // 若目标子目录不存在，则尝试创建（忽略失败，后续写文件会自行报错）
          try {
            if (targetDir !== baseDir) {
              if (!(await exists(targetDir as any))) {
                await mkdir(targetDir as any, {
                  recursive: true,
                } as any)
              }
            }
          } catch {
            // 目录创建失败时保持静默，由后续写文件报错或回退
          }

          const inferNameFromUrl = () => {
            try {
              const u = new URL(urlRaw)
              const path = u.pathname || ''
              const parts = path.split('/').filter(Boolean)
              if (parts.length) return parts[parts.length - 1]
            } catch {
              // 忽略 URL 解析失败
            }
            const withoutQuery = urlRaw.split(/[?#]/)[0]
            const segs = withoutQuery.split('/').filter(Boolean)
            if (segs.length) return segs[segs.length - 1]
            return 'download'
          }

          const rawName =
            (opt && opt.fileName && String(opt.fileName).trim()) ||
            inferNameFromUrl()

          const safeName =
            String(rawName)
              .trim()
              .replace(/[\\/:*?"<>|]+/g, '_') || 'download'

          const makeFull = (name: string) => targetDir + sep + name

          const onConflict = (opt && opt.onConflict) || 'renameAuto'
          let finalName = safeName
          let fullPath = makeFull(finalName)

          if (onConflict === 'error') {
            if (await exists(fullPath as any)) {
              throw new Error('目标文件已存在：' + fullPath)
            }
          } else if (onConflict === 'renameAuto') {
            if (await exists(fullPath as any)) {
              const dot = safeName.lastIndexOf('.')
              const base =
                dot > 0 ? safeName.slice(0, dot) : safeName
              const ext = dot > 0 ? safeName.slice(dot) : ''
              let idx = 1
              while (idx < 10000) {
                const candidate = `${base}-${idx}${ext}`
                const candidateFull = makeFull(candidate)
                // eslint-disable-next-line no-await-in-loop
                if (!(await exists(candidateFull as any))) {
                  finalName = candidate
                  fullPath = candidateFull
                  break
                }
                idx += 1
              }
            }
          }
          // onConflict === 'overwrite' 时不做额外处理，直接写入覆盖

          await writeFile(fullPath as any, data as any)

          // 生成适合写入 Markdown 的相对路径：
          // - 若指定了子目录，则为 "subDir/fileName"
          // - 否则为裸文件名
          const finalNameNorm = finalName.replace(/\\/g, '/')
          const relativePath = relDirForMd
            ? `${relDirForMd.replace(/\\/g, '/')}/${finalNameNorm}`
            : finalNameNorm
          return { fullPath, relativePath }
        } catch (e) {
          console.error(
            `[Plugin ${p.id}] downloadFileToCurrentFolder 失败:`,
            e,
          )
          throw e
        }
      },
      // 将二进制数据保存到当前文档所在目录（或库根目录）
      // 返回 { fullPath, relativePath }，relativePath 适合作为当前文档中的相对引用
      saveBinaryToCurrentFolder: async (opt: {
        fileName: string
        data: Uint8Array | ArrayBuffer | number[]
        subDir?: string
        onConflict?: 'overwrite' | 'renameAuto' | 'error'
      }): Promise<{ fullPath: string; relativePath: string }> => {
        try {
          if (!opt || !opt.fileName) {
            throw new Error('fileName 不能为空')
          }
          if (!opt.data) {
            throw new Error('data 不能为空')
          }
          const root = await deps.getLibraryRoot()
          if (!root) {
            throw new Error('当前未打开任何库')
          }
          const rootNorm = String(root).replace(/[\\/]+$/, '')
          const current = deps.getCurrentFilePath()

          // 优先使用当前文件所在目录；否则退回库根目录
          let baseDir = rootNorm
          if (current && current.startsWith(rootNorm)) {
            baseDir = current.replace(/[\\/][^\\/]*$/, '')
          }

          const sep = baseDir.includes('\\') ? '\\' : '/'

          let targetDir = baseDir
          let relDirForMd = ''
          const subDirRaw =
            opt && typeof opt.subDir === 'string'
              ? opt.subDir.trim()
              : ''
          if (subDirRaw) {
            const cleanSub = subDirRaw
              .replace(/[\\]+/g, '/')
              .replace(/^\/+|\/+$/g, '')
            if (cleanSub) {
              targetDir =
                baseDir + sep + cleanSub.replace(/\//g, sep)
              relDirForMd = cleanSub
            }
          }

          try {
            if (targetDir !== baseDir) {
              if (!(await exists(targetDir as any))) {
                await mkdir(targetDir as any, {
                  recursive: true,
                } as any)
              }
            }
          } catch {
            // 目录创建失败时保持静默，由后续写文件报错或回退
          }

          const safeName =
            String(opt.fileName)
              .trim()
              .replace(/[\\/:*?"<>|]+/g, '_') || 'file.bin'

          const makeFull = (name: string) => targetDir + sep + name

          const onConflict = opt.onConflict || 'renameAuto'
          let finalName = safeName
          let fullPath = makeFull(finalName)

          if (onConflict === 'error') {
            if (await exists(fullPath as any)) {
              throw new Error('目标文件已存在：' + fullPath)
            }
          } else if (onConflict === 'renameAuto') {
            if (await exists(fullPath as any)) {
              const dot = safeName.lastIndexOf('.')
              const base =
                dot > 0 ? safeName.slice(0, dot) : safeName
              const ext = dot > 0 ? safeName.slice(dot) : ''
              let idx = 1
              while (idx < 10000) {
                const candidate = `${base}-${idx}${ext}`
                const candidateFull = makeFull(candidate)
                // eslint-disable-next-line no-await-in-loop
                if (!(await exists(candidateFull as any))) {
                  finalName = candidate
                  fullPath = candidateFull
                  break
                }
                idx += 1
              }
            }
          }
          // onConflict === 'overwrite' 时不做额外处理，直接写入覆盖

          let bytes: Uint8Array
          if (opt.data instanceof Uint8Array) {
            bytes = opt.data
          } else if (opt.data instanceof ArrayBuffer) {
            bytes = new Uint8Array(opt.data)
          } else if (Array.isArray(opt.data)) {
            bytes = new Uint8Array(opt.data as any)
          } else {
            throw new Error('data 必须是 Uint8Array / ArrayBuffer / number[]')
          }

          await writeFile(fullPath as any, bytes as any)

          const finalNameNorm = finalName.replace(/\\/g, '/')
          const relativePath = relDirForMd
            ? `${relDirForMd.replace(/\\/g, '/')}/${finalNameNorm}`
            : finalNameNorm
          return { fullPath, relativePath }
        } catch (e) {
          console.error(
            `[Plugin ${p.id}] saveBinaryToCurrentFolder 失败:`,
            e,
          )
          throw e
        }
      },
      saveMarkdownToCurrentFolder: async (opt: {
        fileName: string
        content: string
        onConflict?: 'overwrite' | 'renameAuto' | 'error'
      }) => {
        try {
          if (!opt || !opt.fileName) {
            throw new Error('fileName 不能为空')
          }
          const root = await deps.getLibraryRoot()
          if (!root) {
            throw new Error('当前未打开任何库')
          }
          const rootNorm = String(root).replace(/[\\/]+$/, '')
          const current = deps.getCurrentFilePath()

          // 优先使用当前文件所在目录；否则退回库根目录
          let baseDir = rootNorm
          if (current && current.startsWith(rootNorm)) {
            baseDir = current.replace(/[\\/][^\\/]*$/, '')
          }

          const sep = baseDir.includes('\\') ? '\\' : '/'
          const safeName =
            String(opt.fileName)
              .trim()
              .replace(/[\\/:*?"<>|]+/g, '_') || 'document.md'

          const makeFull = (name: string) =>
            baseDir + sep + name

          const onConflict = opt.onConflict || 'renameAuto'
          let finalName = safeName
          let fullPath = makeFull(finalName)

          if (onConflict === 'error') {
            if (await exists(fullPath as any)) {
              throw new Error('目标文件已存在：' + fullPath)
            }
          } else if (onConflict === 'renameAuto') {
            if (await exists(fullPath as any)) {
              const dot = safeName.lastIndexOf('.')
              const base =
                dot > 0 ? safeName.slice(0, dot) : safeName
              const ext = dot > 0 ? safeName.slice(dot) : ''
              let idx = 1
              while (idx < 10000) {
                const candidate = `${base}-${idx}${ext}`
                const candidateFull = makeFull(candidate)
                // eslint-disable-next-line no-await-in-loop
                if (!(await exists(candidateFull as any))) {
                  finalName = candidate
                  fullPath = candidateFull
                  break
                }
                idx += 1
              }
            }
          }
          // onConflict === 'overwrite' 时不做额外处理，直接写入覆盖

          const encoder = new TextEncoder()
          const data = encoder.encode(String(opt.content || ''))
          await writeFile(fullPath as any, data as any)
          return fullPath
        } catch (e) {
          console.error(
            `[Plugin ${p.id}] saveMarkdownToCurrentFolder 失败:`,
            e,
          )
          throw e
        }
      },
      pickDirectory: async (opt?: { defaultPath?: string }) => {
        try {
          if (typeof open !== 'function') {
            alert('目录选择功能需要在桌面版中使用')
            return ''
          }
          const picked = await open({
            directory: true,
            defaultPath:
              opt && opt.defaultPath ? opt.defaultPath : undefined,
          } as any)
          const dir =
            typeof picked === 'string'
              ? picked
              : ((picked as any)?.path || '')
          return dir ? String(dir) : ''
        } catch (e) {
          console.error('plugin pickDirectory 失败', e)
          return ''
        }
      },
      pickDocFiles: async (opt?: { multiple?: boolean }) => {
        try {
          if (typeof open !== 'function') {
            alert('文件打开功能需要在 Tauri 应用中使用')
            return [] as string[]
          }
          const sel = await open({
            multiple: !!(opt && opt.multiple),
            filters: [
              {
                name: 'Markdown',
                extensions: ['md', 'markdown', 'txt'],
              },
            ],
          })
          if (!sel) return [] as string[]
          if (Array.isArray(sel)) {
            return sel.map((x) => String(x || ''))
          }
          return [String(sel)]
        } catch (e) {
          console.error('plugin pickDocFiles 失败', e)
          return [] as string[]
        }
      },
      addContextMenuItem: (config: ContextMenuItemConfig) => {
        try {
          state.pluginContextMenuItems.push({
            pluginId: p.id,
            config,
          })
          return () => {
            try {
              const index = state.pluginContextMenuItems.findIndex(
                (item) =>
                  item.pluginId === p.id &&
                  item.config === config,
              )
              if (index >= 0) {
                state.pluginContextMenuItems.splice(index, 1)
              }
            } catch {}
          }
        } catch {
          return () => {}
        }
      },
      registerAPI: (namespace: string, api: any) => {
        try {
          if (!namespace || typeof namespace !== 'string') {
            console.warn(
              `[Plugin ${p.id}] registerAPI: namespace 必须是非空字符串`,
            )
            return
          }
          const existing = state.pluginAPIRegistry.get(namespace)
          if (existing && existing.pluginId !== p.id) {
            console.warn(
              `[Plugin ${p.id}] registerAPI: 命名空间 "${namespace}" 已被插件 "${existing.pluginId}" 占用，` +
                `请使用不同的命名空间或卸载冲突的插件`,
            )
            return
          }
          state.pluginAPIRegistry.set(namespace, {
            pluginId: p.id,
            api,
          })
          console.log(
            `[Plugin ${p.id}] 已注册 API: ${namespace}`,
          )
        } catch (e) {
          console.error(
            `[Plugin ${p.id}] registerAPI 失败:`,
            e,
          )
        }
      },
      getPluginAPI: (namespace: string) => {
        try {
          if (!namespace || typeof namespace !== 'string') {
            console.warn(
              `[Plugin ${p.id}] getPluginAPI: namespace 必须是非空字符串`,
            )
            return null
          }
          const record = state.pluginAPIRegistry.get(namespace)
          if (!record) return null
          return record.api
        } catch (e) {
          console.error(
            `[Plugin ${p.id}] getPluginAPI 失败:`,
            e,
          )
          return null
        }
      },
      onSelectionChange: (
        listener: ((sel: {
          start: number
          end: number
          text: string
        }) => void) | null,
      ) => {
        try {
          if (!listener) {
            state.pluginSelectionHandlers.delete(p.id)
          } else {
            state.pluginSelectionHandlers.set(p.id, listener)
          }
        } catch {}
      },
      getPreviewElement: () => {
        try {
          const root = deps.getPreviewRoot()
          if (!root) return null
          return root.querySelector(
            '.preview-body',
          ) as HTMLElement | null
        } catch (e) {
          console.error(
            `[Plugin ${p.id}] getPreviewElement 失败:`,
            e,
          )
          return null
        }
      },
      readImageAsDataUrl: async (absPath: string) => {
        try {
          if (typeof readFile !== 'function') {
            throw new Error(
              '读取图片功能需要在 Tauri 应用中使用',
            )
          }
          const abs = String(absPath || '').trim()
          if (!abs) {
            throw new Error('absPath 不能为空')
          }
          const bytes = await readFile(abs as any)
          const mime = (() => {
            const m = abs.toLowerCase().match(/\.([a-z0-9]+)$/)
            switch (m?.[1]) {
              case 'jpg':
              case 'jpeg':
                return 'image/jpeg'
              case 'png':
                return 'image/png'
              case 'gif':
                return 'image/gif'
              case 'webp':
                return 'image/webp'
              case 'bmp':
                return 'image/bmp'
              case 'avif':
                return 'image/avif'
              case 'ico':
                return 'image/x-icon'
              case 'svg':
                return 'image/svg+xml'
              default:
                return 'application/octet-stream'
            }
          })()
          const blob = new Blob([bytes], { type: mime })
          const dataUrl = await new Promise<string>(
            (resolve, reject) => {
              try {
                const fr = new FileReader()
                fr.onerror = () =>
                  reject(fr.error || new Error('读取图片失败'))
                fr.onload = () =>
                  resolve(String(fr.result || ''))
                fr.readAsDataURL(blob)
              } catch (e) {
                reject(e as any)
              }
            },
          )
          return dataUrl
        } catch (e) {
          console.error(
            `[Plugin ${p.id}] readImageAsDataUrl 失败:`,
            e,
          )
          throw e
        }
      },
      saveFileWithDialog: async (opt: {
        filters?: Array<{ name: string; extensions: string[] }>
        data: Uint8Array
        defaultName?: string
      }) => {
        try {
          if (
            typeof save !== 'function' ||
            typeof writeFile !== 'function'
          ) {
            throw new Error(
              '文件保存功能需要在 Tauri 应用中使用',
            )
          }
          if (!opt || !opt.data) {
            throw new Error('缺少 data 参数')
          }
          const target = await save({
            filters:
              opt.filters || [
                { name: '所有文件', extensions: ['*'] },
              ],
            defaultPath: opt.defaultName,
          })
          if (!target) {
            return null
          }
          await writeFile(target as any, opt.data as any)
          return target as string
        } catch (e) {
          console.error(
            `[Plugin ${p.id}] saveFileWithDialog 失败:`,
            e,
          )
          throw e
        }
      },
    }

    try {
      ;(window as any).__pluginCtx__ =
        (window as any).__pluginCtx__ || {}
      ;(window as any).__pluginCtx__[p.id] = ctx
    } catch {}

    if (typeof mod?.activate === 'function') {
      await mod.activate(ctx)
    }
    state.activePlugins.set(p.id, mod)
    // 确保菜单系统已初始化（收纳到菜单或单独按钮）
    try {
      initPluginsMenu()
    } catch {}
  }

  async function deactivatePlugin(id: string): Promise<void> {
    const mod = state.activePlugins.get(id)
    if (!mod) return
    try {
      if (typeof mod?.deactivate === 'function') {
        await mod.deactivate()
      }
    } catch {}
    state.activePlugins.delete(id)
    try {
      state.pluginMenuAdded.delete(id)
      const disposers = state.pluginMenuDisposers.get(id)
      if (disposers && disposers.length) {
        for (const fn of disposers) {
          try { fn() } catch {}
        }
      }
      state.pluginMenuDisposers.delete(id)
    } catch {}
    try {
      for (let i = state.pluginContextMenuItems.length - 1; i >= 0; i--) {
        if (state.pluginContextMenuItems[i]?.pluginId === id) {
          state.pluginContextMenuItems.splice(i, 1)
        }
      }
    } catch {}
    try {
      const keysToDelete: string[] = []
      for (const [key, panel] of state.pluginDockPanels.entries()) {
        if (panel.pluginId === id) {
          keysToDelete.push(key)
        }
      }
      for (const key of keysToDelete) {
        state.pluginDockPanels.delete(key)
      }
      deps.updatePluginDockGaps()
    } catch {}
    try {
      const namespacesToRemove: string[] = []
      for (const [namespace, record] of state.pluginAPIRegistry.entries()) {
        if (record.pluginId === id) {
          namespacesToRemove.push(namespace)
        }
      }
      for (const namespace of namespacesToRemove) {
        state.pluginAPIRegistry.delete(namespace)
        console.log(`[Plugin ${id}] 已移除 API: ${namespace}`)
      }
    } catch {}
  }

  function getActivePluginModule(id: string): any {
    return state.activePlugins.get(id)
  }

  function getPluginAPI(namespace: string): any | null {
    if (!namespace || typeof namespace !== 'string') return null
    const record = state.pluginAPIRegistry.get(namespace)
    return record?.api ?? null
  }

  function getContextMenuItems(): PluginContextMenuItem[] {
    return state.pluginContextMenuItems
  }

  async function openPluginSettings(p: InstalledPlugin): Promise<void> {
    try {
      const mod = state.activePlugins.get(p.id)
      const http = await getHttpClient()
      const ctx = {
        http,
        invoke,
        storage: {
          get: async (key: string) => {
            try {
              const store = deps.getStore()
              if (!store) return null
              const all =
                ((await store.get('plugin:' + p.id)) as any) || {}
              return all[key]
            } catch {
              return null
            }
          },
          set: async (key: string, value: any) => {
            try {
              const store = deps.getStore()
              if (!store) return
              const all =
                ((await store.get('plugin:' + p.id)) as any) || {}
              all[key] = value
              await store.set('plugin:' + p.id, all)
              await store.save()
            } catch {}
          },
        },
        ui: {
          notice: (
            msg: string,
            level?: 'ok' | 'err',
            ms?: number,
          ) => deps.pluginNotice(msg, level, ms),
          showNotification: (
            message: string,
            options?: {
              type?: 'success' | 'error' | 'info'
              duration?: number
              onClick?: () => void
            },
          ) => {
            try {
              const opt = options || {}
              let notifType: NotificationType = 'plugin-success'
              if (opt.type === 'error') notifType = 'plugin-error'
              else if (opt.type === 'info') notifType = 'extension'
              else notifType = 'plugin-success'
              return NotificationManager.show(
                notifType,
                message,
                opt.duration,
                opt.onClick,
              )
            } catch (err) {
              console.error(
                '[Plugin] showNotification 失败',
                err,
              )
              return ''
            }
          },
          hideNotification: (id: string) => {
            try {
              NotificationManager.hide(id)
            } catch (err) {
              console.error(
                '[Plugin] hideNotification 失败',
                err,
              )
            }
          },
          confirm: async (m: string) => {
            try {
              return await deps.confirmNative(m, '确认')
            } catch {
              return false
            }
          },
        },
        getEditorValue: () => {
          const ed = deps.getEditor()
          return ed?.value ?? ''
        },
        setEditorValue: (v: string) => {
          try {
            const ed = deps.getEditor()
            if (!ed) return
            ed.value = v
            deps.markDirtyAndRefresh()
            if (deps.isPreviewMode()) {
              void deps.renderPreview()
            } else if (deps.isWysiwyg()) {
              deps.scheduleWysiwygRender()
            }
          } catch {}
        },
      }
      if (mod && typeof (mod as any).openSettings === 'function') {
        await (mod as any).openSettings(ctx)
      } else {
        deps.pluginNotice(
          t('ext.settings.notProvided') ||
            '此扩展未提供设置面板',
          'err',
          1600,
        )
      }
    } catch (err) {
      deps.pluginNotice(
        t('ext.settings.openFail') || '打开扩展设置失败',
        'err',
        2000,
      )
      console.error('[Extensions] 打开扩展设置失败', err)
    }
  }

  return {
    activatePlugin,
    deactivatePlugin,
    getActivePluginModule,
    getPluginAPI,
    getContextMenuItems,
    openPluginSettings,
  }
}
