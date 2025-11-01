/*
  移动端 UI 交互逻辑
  - FAB（浮动操作按钮）
  - 抽屉式文件库
  - 虚拟键盘适配
*/

import { isMobile } from './platform'

// 初始化移动端 UI
export function initMobileUI(): void {
  if (!isMobile()) return

  // 移动端改用左侧侧滑菜单（替换 FAB）
  createSideMenu()

  // 创建抽屉遮罩层
  createDrawerOverlay()

  // 适配虚拟键盘
  adaptVirtualKeyboard()

  // 禁用桌面端拖拽打开文件
  disableDragDrop()
}

// ========== 侧滑菜单（移动端） ==========
function createSideMenu(): void {
  // 菜单容器
  const menu = document.createElement('nav')
  menu.id = 'sideMenu'
  menu.className = 'side-menu'
  menu.setAttribute('aria-label', '移动端菜单')
  menu.innerHTML = `
    <div class="side-menu-header">菜单</div>
    <button class="side-item" data-action="library">📚 <span>库</span></button>
    <button class="side-item" data-action="edit">✏️ <span>编辑</span></button>
    <button class="side-item" data-action="preview">👁️ <span>预览</span></button>
    <button class="side-item" data-action="webdav">☁️ <span>WebDAV 同步</span></button>
  `
  document.body.appendChild(menu)

  // 遮罩层
  let overlay = document.getElementById('sideMenuOverlay') as HTMLDivElement | null
  if (!overlay) {
    overlay = document.createElement('div') as HTMLDivElement
    overlay.id = 'sideMenuOverlay'
    overlay.className = 'side-menu-overlay'
    document.body.appendChild(overlay)
  }

  // 汉堡按钮（浮在左上角）
  const btn = document.createElement('button')
  btn.id = 'mobileHamburger'
  btn.className = 'mobile-hamburger'
  btn.setAttribute('aria-label', '打开菜单')
  btn.innerHTML = '<span></span><span></span><span></span>'
  document.body.appendChild(btn)

  const open = () => { menu.classList.add('open'); overlay!.classList.add('show') }
  const close = () => { menu.classList.remove('open'); overlay!.classList.remove('show') }

  btn.addEventListener('click', () => {
    if (menu.classList.contains('open')) close(); else open()
  })
  overlay.addEventListener('click', () => close())

  // 菜单项点击 -> 触发动作并关闭菜单
  menu.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('.side-item') as HTMLElement | null
    if (!t) return
    const action = t.dataset.action || ''
    triggerFABAction(action)
    close()
  })

  // 轻微滑动手势（从左边缘右滑打开）
  try {
    let startX = 0, startY = 0, tracking = false
    window.addEventListener('touchstart', (ev) => {
      const t = ev.touches?.[0]
      if (!t) return
      startX = t.clientX; startY = t.clientY
      tracking = (startX < 20) // 左边缘 20px 内
    }, { passive: true } as any)
    window.addEventListener('touchmove', (ev) => {
      if (!tracking) return
      const t = ev.touches?.[0]; if (!t) return
      const dx = t.clientX - startX; const dy = Math.abs(t.clientY - startY)
      if (dx > 40 && dy < 30) { // 右滑且较直
        open(); tracking = false
      }
    }, { passive: true } as any)
    window.addEventListener('touchend', () => { tracking = false })
  } catch {}
}

// 创建浮动操作按钮
function createFAB(): void {
  const container = document.createElement('div')
  container.className = 'fab-container'
  container.innerHTML = `
    <button class="fab-main" id="fabMain" aria-label="操作菜单">
      <span>+</span>
    </button>
    <div class="fab-menu" id="fabMenu">
      <button class="fab-item" data-action="library" data-label="文件库" aria-label="打开文件库">
        📁
      </button>
      <button class="fab-item" data-action="preview" data-label="预览" aria-label="切换预览">
        👁️
      </button>
      <button class="fab-item" data-action="save" data-label="保存" aria-label="保存文件">
        💾
      </button>
      <button class="fab-item" data-action="open" data-label="打开" aria-label="打开文件">
        📂
      </button>
      <button class="fab-item" data-action="new" data-label="新建" aria-label="新建文件">
        📄
      </button>
    </div>
  `
  document.body.appendChild(container)

  // FAB 主按钮点击事件
  const fabMain = document.getElementById('fabMain')!
  const fabMenu = document.getElementById('fabMenu')!
  let isOpen = false

  fabMain.addEventListener('click', () => {
    isOpen = !isOpen
    fabMain.classList.toggle('open', isOpen)
    fabMenu.classList.toggle('open', isOpen)
  })

  // FAB 子按钮点击事件（通过事件委托）
  fabMenu.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const btn = target.closest('.fab-item') as HTMLElement
    if (!btn) return

    const action = btn.dataset.action
    if (!action) return

    // 触发对应操作
    triggerFABAction(action)

    // 关闭菜单
    isOpen = false
    fabMain.classList.remove('open')
    fabMenu.classList.remove('open')
  })

  // 点击其他区域关闭 FAB
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target as Node) && isOpen) {
      isOpen = false
      fabMain.classList.remove('open')
      fabMenu.classList.remove('open')
    }
  })
}

// 触发 FAB 操作（通过自定义事件通知 main.ts）
function triggerFABAction(action: string): void {
  const event = new CustomEvent('fab-action', { detail: { action } })
  window.dispatchEvent(event)
}

// 创建抽屉遮罩层
function createDrawerOverlay(): void {
  const overlay = document.createElement('div')
  overlay.className = 'drawer-overlay'
  overlay.id = 'drawerOverlay'
  document.body.appendChild(overlay)

  // 点击遮罩关闭抽屉
  overlay.addEventListener('click', () => {
    closeDrawer()
  })
}

// 打开抽屉（文件库）
export function openDrawer(): void {
  const panel = document.getElementById('fileTreePanel')
  const overlay = document.getElementById('drawerOverlay')
  if (panel && overlay) {
    panel.classList.add('mobile-open')
    overlay.classList.add('show')
    document.body.style.overflow = 'hidden' // 防止背景滚动
  }
}

// 关闭抽屉
export function closeDrawer(): void {
  const panel = document.getElementById('fileTreePanel')
  const overlay = document.getElementById('drawerOverlay')
  if (panel && overlay) {
    panel.classList.remove('mobile-open')
    overlay.classList.remove('show')
    document.body.style.overflow = ''
  }
}

// 适配虚拟键盘（防止遮挡编辑器）
function adaptVirtualKeyboard(): void {
  // 使用 Visual Viewport API
  if ('visualViewport' in window) {
    const viewport = window.visualViewport!
    const editor = document.getElementById('editor')

    viewport.addEventListener('resize', () => {
      if (!editor) return

      // 计算键盘高度
      const keyboardHeight = window.innerHeight - viewport.height

      if (keyboardHeight > 100) {
        // 键盘弹出
        editor.style.paddingBottom = `${keyboardHeight}px`
      } else {
        // 键盘收起
        editor.style.paddingBottom = '0'
      }
    })
  }
}

// 禁用拖拽打开文件（移动端不支持）
function disableDragDrop(): void {
  document.addEventListener('dragover', (e) => e.preventDefault(), true)
  document.addEventListener('drop', (e) => e.preventDefault(), true)
}

// 监听屏幕旋转
export function onOrientationChange(callback: () => void): void {
  window.addEventListener('orientationchange', callback)
  window.addEventListener('resize', callback)
}

// 请求全屏（移动端沉浸式体验）
export async function requestFullscreen(): Promise<void> {
  try {
    if (document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen()
    }
  } catch (err) {
    console.warn('Fullscreen request failed:', err)
  }
}

// 退出全屏
export async function exitFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen()
    }
  } catch (err) {
    console.warn('Exit fullscreen failed:', err)
  }
}

// 检测是否为平板设备（横屏且宽度较大）
export function isTablet(): boolean {
  return window.innerWidth >= 768 && window.innerWidth < 1200
}

// 震动反馈（Android 支持）
export function vibrate(pattern: number | number[] = 50): void {
  if ('vibrate' in navigator) {
    navigator.vibrate(pattern)
  }
}
