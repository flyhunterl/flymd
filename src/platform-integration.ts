/*
  平台集成层 - 在 main.ts 启动时调用，为移动端打补丁
  通过条件判断和事件监听，让现有桌面代码在移动端也能工作
*/

import { isMobile, getPlatform, openFileDialog, saveFileDialog, readFile, writeFile, type FileRef, addRecentFile } from './platform'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { initMobileUI } from './mobile'
import { openWebdavSyncDialog } from './extensions/webdavSync'

// 全局状态：当前打开的文件引用
let currentFileRef: FileRef | null = null

// 初始化平台集成（在 main.ts 启动时调用）
export async function initPlatformIntegration(): Promise<void> {
  // 移动端初始化 UI
  if (isMobile()) {
    initMobileUI()
    setupFABListeners()
    console.log('[Platform] Mobile UI initialized')
    // 尝试进入全屏（移动端沉浸式体验）。注意：不能完全隐藏系统状态栏/导航栏，需后续在原生层开启沉浸模式。
    try { await getCurrentWindow().setFullscreen(true) } catch {}
  }

  const platform = await getPlatform()
  console.log('[Platform] Running on:', platform)
}

// 设置 FAB 事件监听
function setupFABListeners(): void {
  window.addEventListener('fab-action', ((e: CustomEvent) => {
    const action = e.detail.action
    console.log('[FAB] Action triggered:', action)

    switch (action) {
      case 'new':
        // 触发新建文件
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }))
        break
      case 'open':
        // 触发打开文件
        triggerMobileOpenFile()
        break
      case 'save':
        // 触发保存文件
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
        break
      case 'preview':
        // 触发预览切换（直接点按钮，避免某些环境下合成键盘事件被忽略）
        try { (document.getElementById('btn-toggle') as HTMLElement | null)?.click() } catch {}
        break
      case 'library':
        // 切换库侧栏（复用现有按钮逻辑，避免状态不同步）
        try { (document.getElementById('btn-library') as HTMLElement | null)?.click() } catch {}
        break
      case 'edit': {
        // 显式进入编辑：若当前为预览，则触发一次切换；若处于所见模式，也关闭所见
        try {
          const container = document.querySelector('.container') as HTMLDivElement | null
          const preview = document.getElementById('preview') as HTMLDivElement | null
          const inWysiwyg = !!container?.classList.contains('wysiwyg')
          const inPreview = !!preview && !preview.classList.contains('hidden') && !inWysiwyg
          if (inPreview) { (document.getElementById('btn-toggle') as HTMLElement | null)?.click() }
          if (inWysiwyg) { (document.getElementById('btn-wysiwyg') as HTMLElement | null)?.click() }
        } catch {}
        break
      }
      case 'webdav':
        // 打开 WebDAV 同步设置
        try { void openWebdavSyncDialog() } catch {}
        break
    }
  }) as EventListener)
}

// 移动端打开文件（替代桌面对话框）
async function triggerMobileOpenFile(): Promise<void> {
  try {
    const fileRef = await openFileDialog()
    if (!fileRef) return

    const content = await readFile(fileRef)

    // 更新编辑器内容（通过访问全局变量）
    const editor = document.getElementById('editor') as HTMLTextAreaElement
    if (editor) {
      editor.value = content
      currentFileRef = fileRef
      addRecentFile(fileRef)

      // 触发 input 事件让主程序更新状态
      editor.dispatchEvent(new Event('input', { bubbles: true }))

      // 更新标题
      document.title = `${fileRef.name} - flymd`

      console.log('[Platform] File opened:', fileRef.name)
    }
  } catch (e) {
    console.error('[Platform] Failed to open file:', e)
    alert('打开文件失败: ' + (e as Error).message)
  }
}

// 移动端保存文件（替代桌面对话框）
export async function mobileSaveFile(content: string, currentPath?: string): Promise<boolean> {
  try {
    let fileRef: FileRef | null = null

    // 如果已有打开的文件引用，直接保存
    if (currentFileRef) {
      fileRef = currentFileRef
    } else if (currentPath) {
      // 如果有路径（桌面端传来的），尝试转换为 FileRef
      const platform = await getPlatform()
      const name = currentPath.split(/[/\\]/).pop() || 'document.md'
      fileRef = { path: currentPath, name, platform }
    } else {
      // 否则弹出保存对话框
      fileRef = await saveFileDialog('untitled.md')
    }

    if (!fileRef) return false

    await writeFile(fileRef, content)
    currentFileRef = fileRef
    addRecentFile(fileRef)

    console.log('[Platform] File saved:', fileRef.name)
    return true
  } catch (e) {
    console.error('[Platform] Failed to save file:', e)
    alert('保存文件失败: ' + (e as Error).message)
    return false
  }
}

// 获取当前文件引用（供外部查询）
export function getCurrentFileRef(): FileRef | null {
  return currentFileRef
}

// 设置当前文件引用（供外部设置）
export function setCurrentFileRef(ref: FileRef | null): void {
  currentFileRef = ref
}

// 检查是否为移动平台（同步方法，用于条件判断）
export function isMobilePlatform(): boolean {
  return isMobile()
}
