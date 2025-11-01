/*
  平台检测与适配层
  - 桌面端：使用 Tauri 文件系统插件（路径模式）
  - Android：使用 SAF（URI 模式）
*/

import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'

// 平台类型
export type Platform = 'windows' | 'linux' | 'macos' | 'android' | 'unknown'

// 文件引用（桌面用路径，Android 用 URI）
export type FileRef = {
  path: string  // 桌面：文件路径，Android：content:// URI
  name: string  // 文件名
  platform: Platform
}

let cachedPlatform: Platform | null = null

// 获取当前平台
export async function getPlatform(): Promise<Platform> {
  if (cachedPlatform) return cachedPlatform
  try {
    cachedPlatform = await invoke<Platform>('get_platform')
  } catch {
    cachedPlatform = 'unknown'
  }
  return cachedPlatform
}

// 同步检测是否为移动端（基于 User-Agent）
export function isMobile(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
}

// 打开文件对话框（跨平台）
export async function openFileDialog(): Promise<FileRef | null> {
  const platform = await getPlatform()

  if (platform === 'android') {
    try {
      const uri = await invoke<string>('android_pick_document')
      // 从 URI 提取文件名（简化处理）
      const name = uri.split('/').pop() || 'document.md'
      return { path: uri, name, platform }
    } catch (e) {
      console.error('Android pick document failed:', e)
      return null
    }
  } else {
    // 桌面端
    const path = await open({
      multiple: false,
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (!path) return null
    const name = path.split(/[/\\]/).pop() || 'document.md'
    return { path, name, platform }
  }
}

// 保存文件对话框（跨平台）
export async function saveFileDialog(defaultName: string = 'untitled.md'): Promise<FileRef | null> {
  const platform = await getPlatform()

  if (platform === 'android') {
    try {
      const uri = await invoke<string>('android_create_document', {
        filename: defaultName,
        mimeType: 'text/markdown'
      })
      return { path: uri, name: defaultName, platform }
    } catch (e) {
      console.error('Android create document failed:', e)
      return null
    }
  } else {
    // 桌面端
    const path = await save({
      defaultPath: defaultName,
      filters: [
        { name: 'Markdown', extensions: ['md'] }
      ]
    })
    if (!path) return null
    const name = path.split(/[/\\]/).pop() || defaultName
    return { path, name, platform }
  }
}

// 读取文件（跨平台）
export async function readFile(ref: FileRef): Promise<string> {
  if (ref.platform === 'android') {
    return await invoke<string>('android_read_uri', { uri: ref.path })
  } else {
    return await readTextFile(ref.path)
  }
}

// 写入文件（跨平台）
export async function writeFile(ref: FileRef, content: string): Promise<void> {
  if (ref.platform === 'android') {
    await invoke('android_write_uri', { uri: ref.path, content })
  } else {
    await writeTextFile(ref.path, content)
  }
}

// 持久化 URI 权限（Android 专用）
export async function persistUriPermission(uri: string): Promise<void> {
  const platform = await getPlatform()
  if (platform === 'android') {
    try {
      await invoke('android_persist_uri_permission', { uri })
    } catch (e) {
      console.warn('Failed to persist URI permission:', e)
    }
  }
}

// 从 localStorage 存储/读取最近文件（Android 用 URI）
const RECENT_FILES_KEY = 'flymd_recent_files'

export function getRecentFiles(): FileRef[] {
  try {
    const json = localStorage.getItem(RECENT_FILES_KEY)
    if (!json) return []
    return JSON.parse(json) as FileRef[]
  } catch {
    return []
  }
}

export function addRecentFile(ref: FileRef): void {
  const recent = getRecentFiles()
  // 去重
  const filtered = recent.filter(f => f.path !== ref.path)
  // 添加到最前
  filtered.unshift(ref)
  // 限制 20 条
  if (filtered.length > 20) filtered.length = 20
  localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(filtered))
}

export function clearRecentFiles(): void {
  localStorage.removeItem(RECENT_FILES_KEY)
}
