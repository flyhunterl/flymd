// 插件运行时宿主：封装 PluginHost + 安装/更新/激活 等逻辑
// 由 main.ts 注入依赖，避免入口文件继续膨胀

import type { Store } from '@tauri-apps/plugin-store'
import { readDir, remove, BaseDirectory } from '@tauri-apps/plugin-fs'
import { NotificationManager } from '../core/uiNotifications'
import type { InstalledPlugin, PluginUpdateState } from './runtime'
import {
  loadInstalledPlugins,
  saveInstalledPlugins,
  getPluginUpdateStates,
  fetchTextSmart,
} from './runtime'
import {
  createPluginMarket,
  FALLBACK_INSTALLABLES,
  type InstallableItem,
} from './market'
import {
  createPluginHost,
  type PluginHost,
  type PluginHostDeps,
  type PluginHostState,
  type PluginDockPanelState,
} from './pluginHost'
import { addToPluginsMenu } from './pluginMenu'
import type { PluginContextMenuItem } from '../ui/contextMenus'
import type { NotificationType } from '../core/uiNotifications'
import { t } from '../i18n'
import { APP_VERSION } from '../core/appInfo'

// 选择变化监听类型（与 pluginHost 中保持一致）
type PluginSelectionHandler = (sel: {
  start: number
  end: number
  text: string
}) => void

type PluginAPIRecord = { pluginId: string; api: any }

// main.ts 注入的运行时依赖
export type PluginRuntimeDeps = {
  getStore: () => Store | null
  getEditor: () => HTMLTextAreaElement | null
  getPreviewRoot: () => HTMLDivElement | null
  getCurrentFilePath: () => string | null
  getLibraryRoot: () => Promise<string | null>
  isPreviewMode: () => boolean
  isWysiwyg: () => boolean
  renderPreview: () => void | Promise<void>
  scheduleWysiwygRender: () => void
  markDirtyAndRefresh: () => void
  splitYamlFrontMatter: (
    raw: string,
  ) => { frontMatter: string | null; body: string }
  yamlLoad: (raw: string) => any
  pluginNotice: (msg: string, level?: 'ok' | 'err', ms?: number) => void
  confirmNative: (message: string, title?: string) => Promise<boolean>
  exportCurrentDocToPdf: (target: string) => Promise<void>
  openFileByPath: (path: string) => Promise<void>
  createStickyNote: (filePath: string) => Promise<void>
  openUploaderSettings: () => void | Promise<void>
  openWebdavSettings: () => void | Promise<void>
  // WebDAV 相关：供插件基础设施使用
  getWebdavConfigSnapshot?: () => Promise<any | null>
  // 所见模式链接应用
  wysiwygV2ApplyLink?: (href: string, labelOrTitle?: string, maybeTitle?: string) => Promise<void>
}

export type PluginRuntimeHandles = {
  pluginHost: PluginHost
  pluginContextMenuItems: PluginContextMenuItem[]

  updatePluginDockGaps: () => void

  getInstalledPlugins: () => Promise<Record<string, InstalledPlugin>>
  setInstalledPlugins: (map: Record<string, InstalledPlugin>) => Promise<void>

  installPluginFromGit: (
    inputRaw: string,
    opt?: { enabled?: boolean; showInMenuBar?: boolean },
  ) => Promise<InstalledPlugin>
  installPluginFromLocal: (
    sourcePath: string,
    opt?: { enabled?: boolean; showInMenuBar?: boolean },
  ) => Promise<InstalledPlugin>

  activatePlugin: (p: InstalledPlugin) => Promise<void>
  deactivatePlugin: (id: string) => Promise<void>
  openPluginSettings: (p: InstalledPlugin) => Promise<void>

  checkPluginUpdatesOnStartup: () => Promise<void>
  updateInstalledPlugin: (
    p: InstalledPlugin,
    info: PluginUpdateState,
  ) => Promise<InstalledPlugin>

  removePluginDir: (dir: string) => Promise<void>

  loadAndActivateEnabledPlugins: () => Promise<void>
}

export function initPluginRuntime(
  deps: PluginRuntimeDeps,
): PluginRuntimeHandles {
  // 插件运行时状态（与 pluginHost 保持一致）
  const activePlugins = new Map<string, any>() // id -> module
  const pluginMenuAdded = new Map<string, boolean>() // 限制每个插件仅添加一个菜单项
  const pluginMenuDisposers = new Map<string, Array<() => void>>() // 每个插件对应的菜单清理函数
  const pluginWatchDisposers = new Map<string, Array<() => void>>() // 每个插件对应的 watch 清理函数
  const pluginAPIRegistry = new Map<string, PluginAPIRecord>() // namespace -> { pluginId, api }
  const additionalSuffixRegistry = new Map<string, any>() // ext -> rule
  const pluginContextMenuItems: PluginContextMenuItem[] = [] // 所有插件注册的右键菜单项
  const pluginSelectionHandlers = new Map<string, PluginSelectionHandler>()
  const pluginDockPanels = new Map<string, PluginDockPanelState>()

  function notifyWorkspaceLayoutChanged(): void {
    try {
      const winAny = window as any
      const fn = winAny && winAny.__onWorkspaceLayoutChanged
      if (typeof fn === 'function') fn()
    } catch {}
  }

  function updatePluginDockGaps(): void {
    try {
      const container = document.querySelector(
        '.container',
      ) as HTMLDivElement | null
      if (!container) return
      let left = 0
      let right = 0
      let bottom = 0
      for (const panel of pluginDockPanels.values()) {
        if (!panel || !panel.visible) continue
        const size = Math.max(0, Number(panel.size) || 0)
        if (!size) continue
        if (panel.side === 'left') left += size
        else if (panel.side === 'right') right += size
        else if (panel.side === 'bottom') bottom += size
      }
      container.style.setProperty(
        '--dock-left-gap',
        left > 0 ? `${left}px` : '0px',
      )
      container.style.setProperty(
        '--dock-right-gap',
        right > 0 ? `${right}px` : '0px',
      )
      container.style.setProperty(
        '--dock-bottom-gap',
        bottom > 0 ? `${bottom}px` : '0px',
      )
      notifyWorkspaceLayoutChanged()
    } catch {}
  }

  // PluginHost 状态与依赖
  const pluginHostState: PluginHostState = {
    activePlugins,
    pluginMenuAdded,
    pluginMenuDisposers,
    pluginWatchDisposers,
    pluginAPIRegistry,
    additionalSuffixRegistry,
    pluginContextMenuItems,
    pluginSelectionHandlers,
    pluginDockPanels,
  }

  const pluginHostDeps: PluginHostDeps = {
    getStore: () => deps.getStore(),
    getEditor: () => deps.getEditor(),
    getPreviewRoot: () => deps.getPreviewRoot(),
    getCurrentFilePath: () => deps.getCurrentFilePath(),
    getLibraryRoot: () => deps.getLibraryRoot(),
    isPreviewMode: () => deps.isPreviewMode(),
    isWysiwyg: () => deps.isWysiwyg(),
    renderPreview: () => deps.renderPreview(),
    scheduleWysiwygRender: () => deps.scheduleWysiwygRender(),
    markDirtyAndRefresh: () => deps.markDirtyAndRefresh(),
    splitYamlFrontMatter: (raw: string) => deps.splitYamlFrontMatter(raw),
    yamlLoad: (raw: string) => deps.yamlLoad(raw),
    pluginNotice: (msg: string, level?: 'ok' | 'err', ms?: number) =>
      deps.pluginNotice(msg, level, ms),
    confirmNative: (message: string, title?: string) =>
      deps.confirmNative(message, title),
    exportCurrentDocToPdf: (target: string) =>
      deps.exportCurrentDocToPdf(target),
    openFileByPath: (path: string) => deps.openFileByPath(path),
    createStickyNote: (filePath: string) => deps.createStickyNote(filePath),
    updatePluginDockGaps: () => updatePluginDockGaps(),
    wysiwygV2ApplyLink: deps.wysiwygV2ApplyLink,
  }

  const pluginHost: PluginHost = createPluginHost(pluginHostDeps, pluginHostState)

  // 内置扩展：收纳 WebDAV 同步与图床设置到"插件"下拉菜单
  try {
    addToPluginsMenu('builtin-webdav-sync', {
      label: t('sync.title') || 'WebDAV 同步',
      onClick: () => { void deps.openWebdavSettings() },
    })
    addToPluginsMenu('builtin-uploader-s3', {
      label: t('ext.builtin.uploaderS3.name' as any) || '图床管理',
      onClick: () => { void deps.openUploaderSettings() },
    })
  } catch {}

  // 插件市场：供自动更新等逻辑使用（扩展面板 UI 自己有一套）
  const pluginMarket = createPluginMarket({
    getStore: () => {
      try {
        return deps.getStore()
      } catch {
        return null
      }
    },
    fetchTextSmart,
  })

  async function getInstalledPlugins(): Promise<Record<string, InstalledPlugin>> {
    try {
      const store = deps.getStore()
      return await loadInstalledPlugins(store)
    } catch {
      return {}
    }
  }

  async function setInstalledPlugins(
    map: Record<string, InstalledPlugin>,
  ): Promise<void> {
    try {
      const store = deps.getStore()
      await saveInstalledPlugins(store, map)
    } catch {}
  }

  async function installPluginFromGit(
    inputRaw: string,
    opt?: { enabled?: boolean; showInMenuBar?: boolean },
  ): Promise<InstalledPlugin> {
    const { installPluginFromGitCore } = await import('./runtime')
    const store = deps.getStore()
    return installPluginFromGitCore(inputRaw, opt, {
      appVersion: APP_VERSION,
      store,
    })
  }

  async function installPluginFromLocal(
    sourcePath: string,
    opt?: { enabled?: boolean; showInMenuBar?: boolean },
  ): Promise<InstalledPlugin> {
    const { installPluginFromLocalCore } = await import('./runtime')
    const store = deps.getStore()
    return installPluginFromLocalCore(sourcePath, opt, {
      appVersion: APP_VERSION,
      store,
    })
  }

  async function activatePlugin(p: InstalledPlugin): Promise<void> {
    return pluginHost.activatePlugin(p)
  }

  async function deactivatePlugin(id: string): Promise<void> {
    return pluginHost.deactivatePlugin(id)
  }

  async function openPluginSettings(p: InstalledPlugin): Promise<void> {
    return pluginHost.openPluginSettings(p)
  }

  // 启动时扩展更新检查：仅在应用启动后后台检查一次
  async function checkPluginUpdatesOnStartup(): Promise<void> {
    try {
      const store = deps.getStore()
      if (!store) return
      // 只在有安装的扩展且带版本号时才进行检查
      const installedMap = await getInstalledPlugins()
      const installedArr = Object.values(installedMap).filter(
        (p) => !!p && !!p.version,
      )
      if (!installedArr.length) return

      let marketItems: InstallableItem[] = []
      try {
        marketItems = await pluginMarket.loadInstallablePlugins(false)
      } catch {
        marketItems = FALLBACK_INSTALLABLES.slice()
      }
      if (!marketItems.length) return

      const updateMap = await getPluginUpdateStates(installedArr, marketItems)
      const ids = Object.keys(updateMap || {})
      if (!ids.length) return

      const updatedPlugins = ids
        .map((id) => installedMap[id])
        .filter((p): p is InstalledPlugin => !!p)

      if (!updatedPlugins.length) return

      // 构造提示文案（保持多语言）
      const names = updatedPlugins
        .map((p) => String(p.name || p.id || ''))
        .filter(Boolean)
      if (!names.length) return

      let msg = ''
      if (names.length === 1) {
        msg = (t('ext.update.notice.single') as string).replace(
          '{name}',
          names[0],
        )
      } else {
        const joined = names.slice(0, 3).join('、')
        msg = (t('ext.update.notice.multi') as string)
          .replace('{count}', String(names.length))
          .replace('{names}', joined + (names.length > 3 ? '…' : ''))
      }

      try {
        let updating = false

        const toUpdate: Array<{ p: InstalledPlugin; info: PluginUpdateState }> =
          []
        for (const id of ids) {
          const p = installedMap[id]
          const info = updateMap[id]
          if (!p || !info) continue
          toUpdate.push({ p, info })
        }

        const runUpdate = async () => {
          if (updating) return
          if (!toUpdate.length) return
          updating = true

          const progressId = NotificationManager.show(
            'extension' as NotificationType,
            t('ext.update.btn') + '...',
            0,
          )

          try {
            let done = 0
            for (const it of toUpdate) {
              done++
              NotificationManager.updateMessage(
                progressId,
                `${t('ext.update.btn')}... (${done}/${toUpdate.length})`,
              )
              const rec = await updateInstalledPlugin(it.p, it.info)
              installedMap[rec.id] = rec
            }
            NotificationManager.hide(progressId)
            NotificationManager.show(
              'plugin-success' as NotificationType,
              t('ext.update.ok'),
              2000,
            )
          } catch (e) {
            NotificationManager.hide(progressId)
            const errMsg = e instanceof Error ? e.message : String(e)
            NotificationManager.show(
              'plugin-error' as NotificationType,
              t('ext.update.fail') + (errMsg ? ': ' + errMsg : ''),
              4000,
            )
          } finally {
            updating = false
          }
        }

        // 使用新的通知系统显示扩展更新通知，并提供“立即更新”按钮
        NotificationManager.showWithActions('extension' as NotificationType, msg, {
          duration: 8000,
          actions: [
            {
              label: t('ext.update.now'),
              onClick: runUpdate,
            },
          ],
        })
      } catch {}
    } catch (e) {
      console.warn('[Extensions] 启动扩展更新检查失败', e)
    }
  }

  async function removePluginDir(dir: string): Promise<void> {
    async function removeDirRecursive(inner: string): Promise<void> {
      try {
        const entries = await readDir(inner as any, {
          baseDir: BaseDirectory.AppLocalData,
        } as any)
        for (const e of entries as any[]) {
          if (e.isDir) {
            await removeDirRecursive(`${inner}/${e.name}`)
          } else {
            try {
              await remove(`${inner}/${e.name}` as any, {
                baseDir: BaseDirectory.AppLocalData,
              } as any)
            } catch {}
          }
        }
        try {
          await remove(inner as any, {
            baseDir: BaseDirectory.AppLocalData,
          } as any)
        } catch {}
      } catch {}
    }

    await removeDirRecursive(dir)
  }

  async function loadAndActivateEnabledPlugins(): Promise<void> {
    try {
      const map = await getInstalledPlugins()
      const toEnable = Object.values(map).filter((p) => p.enabled)

      // 向后兼容：为旧插件设置默认 showInMenuBar = true
      let needSave = false
      for (const p of toEnable) {
        if (p.showInMenuBar === undefined) {
          p.showInMenuBar = true // 旧插件默认独立显示，保持原有行为
          needSave = true
        }
      }
      if (needSave) {
        await setInstalledPlugins(map)
      }

      for (const p of toEnable) {
        try {
          await activatePlugin(p)
        } catch (e) {
          console.warn('插件激活失败', p.id, e)
        }
      }
      // 如果当前窗口为 AI 独立窗口，尝试自动挂载 AI 助手
      try {
        if (location.hash === '#ai-assistant') {
          const ai = (map as any)['ai-assistant']
          if (ai) {
            const mod = pluginHost.getActivePluginModule('ai-assistant') as any
            const ctx = (window as any).__pluginCtx__?.['ai-assistant']
            if (mod && typeof mod?.standalone === 'function' && ctx) {
              await mod.standalone(ctx)
            }
          }
          // 独立窗口：隐藏主界面元素，仅保留插件窗口
          try {
            const style = document.createElement('style')
            style.id = 'ai-standalone-style'
            style.textContent =
              'body>*{display:none !important} #ai-assist-win{display:block !important}'
            document.head.appendChild(style)
          } catch {}
        }
      } catch {}
    } catch {}
  }

  async function updateInstalledPlugin(
    p: InstalledPlugin,
    info: PluginUpdateState,
  ): Promise<InstalledPlugin> {
    const enabled = !!p.enabled
    const showInMenuBar =
      typeof p.showInMenuBar === 'boolean' ? p.showInMenuBar : true
    try {
      await deactivatePlugin(p.id)
    } catch {}
    try {
      await removePluginDir(p.dir)
    } catch {}
    const rec = await installPluginFromGit(info.manifestUrl, {
      enabled,
      showInMenuBar,
    })
    try {
      if (enabled) await activatePlugin(rec)
    } catch {}
    return rec
  }

  return {
    pluginHost,
    pluginContextMenuItems,
    updatePluginDockGaps,
    getInstalledPlugins,
    setInstalledPlugins,
    installPluginFromGit,
    installPluginFromLocal,
    activatePlugin,
    deactivatePlugin,
    openPluginSettings,
    checkPluginUpdatesOnStartup,
    updateInstalledPlugin,
    removePluginDir,
    loadAndActivateEnabledPlugins,
  }
}
