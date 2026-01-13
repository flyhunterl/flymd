import { readDir, stat, mkdir, rename, remove, exists, writeTextFile, writeFile, readFile, watch } from '@tauri-apps/plugin-fs'
import { t } from './i18n'

export type FileTreeOptions = {
  // 获取库根目录（未设置时返回 null）
  getRoot: () => Promise<string | null>
  // 打开已有文件（双击文件触发）
  onOpenFile: (path: string) => Promise<void> | void
  // 新建文件后打开（用于默认进入编辑态）
  onOpenNewFile?: (path: string) => Promise<void> | void
  // Additional Suffix Plugin（ASP）：按需扩展文件树的可见后缀与图标
  // 返回对象 key 为后缀（不带点，建议小写），value 为展示配置
  getAdditionalSuffixMeta?: () => Promise<Record<string, FileTreeAdditionalSuffixMeta>> | Record<string, FileTreeAdditionalSuffixMeta>
  // 状态变更回调（选中/展开变化时可通知外层）
  onStateChange?: () => void
  // 文件被移动后的通知（用于外层更新当前打开文件路径等）
  onMoved?: (src: string, dst: string) => Promise<void> | void
}

export type FileTreeAdditionalSuffixMeta = {
  show?: boolean
  icon?: 'file' | 'pdf'
}

export type FileTreeAPI = {
  init: (container: HTMLElement, opts: FileTreeOptions) => Promise<void>
  refresh: () => Promise<void>
  // 外部同步：展开并选中指定路径（用于多标签切换时同步侧栏高亮）
  revealAndSelect: (path: string | null) => Promise<void>
  getSelectedDir: () => string | null
  newFileInSelected: () => Promise<void>
  newFolderInSelected: () => Promise<void>
  // 设置排序方式
  setSort: (mode: 'name_asc' | 'name_desc' | 'mtime_asc' | 'mtime_desc') => void
}

const state = {
  container: null as HTMLElement | null,
  opts: null as FileTreeOptions | null,
  expanded: new Set<string>(),
  selected: null as string | null,
  selectedIsDir: false,
  watching: false,
  unwatch: null as null | (() => void),
  sortMode: 'name_asc' as 'name_asc' | 'name_desc' | 'mtime_asc' | 'mtime_desc',
  currentRoot: null as string | null,
  // ASP：后缀展示配置与 allow-set 缓存（仅在 refresh/render 时更新）
  additionalSuffixMeta: null as Record<string, FileTreeAdditionalSuffixMeta> | null,
  additionalSuffixAllow: null as Set<string> | null,
}

function normalizeSuffixKey(raw: string): string {
  try {
    let ext = String(raw || '').trim().toLowerCase()
    if (ext.startsWith('.')) ext = ext.slice(1)
    ext = ext.replace(/\s+/g, '').replace(/[^a-z0-9+_-]/g, '')
    return ext
  } catch {
    return ''
  }
}

async function updateAdditionalSuffixCache(): Promise<void> {
  const meta: Record<string, FileTreeAdditionalSuffixMeta> = {}
  try {
    const fn =
      state.opts?.getAdditionalSuffixMeta ||
      ((window as any).__flymdGetAdditionalSuffixMeta as any)
    const raw = typeof fn === 'function' ? await fn() : null
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw as any)) {
        const ext = normalizeSuffixKey(k)
        if (!ext) continue
        const item = (v && typeof v === 'object') ? (v as any) : {}
        const show =
          typeof item.show === 'boolean' ? item.show : true
        const icon: 'file' | 'pdf' =
          item.icon === 'pdf' ? 'pdf' : 'file'
        meta[ext] = { show, icon }
      }
    }
  } catch {}

  const allow = new Set(['md', 'markdown', 'txt', 'pdf'])
  for (const [ext, item] of Object.entries(meta)) {
    if (item && item.show === false) continue
    allow.add(ext)
  }

  state.additionalSuffixMeta = meta
  state.additionalSuffixAllow = allow
}

async function ensureAdditionalSuffixCache(): Promise<void> {
  if (state.additionalSuffixMeta && state.additionalSuffixAllow) return
  await updateAdditionalSuffixCache()
}

// 文件监听回调可能非常频繁（尤其是 Linux/inotify），必须做去抖与串行化刷新
let _watchRefreshTimer: number | null = null
let _watchRefreshRunning = false
let _watchRefreshPending = false

function resetWatchRefreshScheduler() {
  try {
    if (_watchRefreshTimer != null) {
      clearTimeout(_watchRefreshTimer)
      _watchRefreshTimer = null
    }
  } catch {}
  _watchRefreshRunning = false
  _watchRefreshPending = false
}

function isRelevantWatchEvent(ev: any): boolean {
  // 只对 create/modify/remove（以及兜底 any）响应；忽略 access，避免“自己读目录/读文件触发自己刷新”的循环
  try {
    const t = ev?.type as any
    if (!t) return true
    if (t === 'any') return true
    if (t === 'other') return true
    if (typeof t === 'object') {
      if (t.access) return false
      if (t.create || t.modify || t.remove) return true
      // 未知事件类型：宁可刷新一次，也不要悄悄不同步
      return true
    }
  } catch {}
  return true
}

function scheduleRefreshTreeFromWatch() {
  try {
    if (_watchRefreshTimer != null) clearTimeout(_watchRefreshTimer)
    _watchRefreshTimer = window.setTimeout(async () => {
      _watchRefreshTimer = null
      if (_watchRefreshRunning) {
        _watchRefreshPending = true
        return
      }
      _watchRefreshRunning = true
      try {
        await refreshTree()
      } catch {
        // 忽略监听触发的刷新异常：不能因为监听崩掉 UI
      } finally {
        _watchRefreshRunning = false
        if (_watchRefreshPending) {
          _watchRefreshPending = false
          scheduleRefreshTreeFromWatch()
        }
      }
    }, 250)
  } catch {}
}

const EXPANDED_KEY_PREFIX = 'flymd:libExpanded:'
function expandedStorageKey(root: string) {
  return `${EXPANDED_KEY_PREFIX}${root}`
}

function restoreExpandedState(root: string | null) {
  state.expanded = new Set<string>()
  if (!root) return
  let restored = false
  try {
    const raw = localStorage.getItem(expandedStorageKey(root))
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        restored = true
        for (const item of arr) {
          if (typeof item === 'string') state.expanded.add(item)
        }
      }
    }
  } catch {}
  if (!restored) state.expanded.add(root)
}

function persistExpandedState() {
  try {
    const root = state.currentRoot
    if (!root) return
    const arr = Array.from(state.expanded)
    localStorage.setItem(expandedStorageKey(root), JSON.stringify(arr))
  } catch {}
}

function setExpandedState(path: string, expanded: boolean) {
  state.expanded[expanded ? 'add' : 'delete'](path)
  persistExpandedState()
}

// 目录递归包含受支持文档的缓存
const hasDocCache = new Map<string, boolean>()
const hasDocPending = new Map<string, Promise<boolean>>()

// 文件夹自定义排序映射：父目录 -> 子目录路径 -> 顺序索引（仅作用于文件夹）
const folderOrder: Record<string, Record<string, number>> = {}
const FOLDER_ORDER_KEY = 'flymd:folderOrder'

function loadFolderOrder() {
  try {
    const raw = localStorage.getItem(FOLDER_ORDER_KEY)
    if (!raw) return
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return
    for (const [parent, children] of Object.entries(obj as any)) {
      if (!children || typeof children !== 'object') continue
      const m: Record<string, number> = {}
      for (const [child, ord] of Object.entries(children as any)) {
        const n = Number(ord)
        if (Number.isFinite(n)) m[child] = n
      }
      folderOrder[parent] = m
    }
  } catch {}
}

function saveFolderOrder() {
  try {
    localStorage.setItem(FOLDER_ORDER_KEY, JSON.stringify(folderOrder))
  } catch {}
}

// 获取某父目录下单个子目录的手动顺序索引（未设置时返回 Infinity）
function getFolderOrder(parent: string, child: string): number {
  const m = folderOrder[parent]
  if (!m) return Number.POSITIVE_INFINITY
  const n = m[child]
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY
}

// 更新某父目录下的文件夹顺序（传入当前的子目录路径数组，按该数组顺序重建索引）
function setFolderOrderForParent(parent: string, children: string[]) {
  const m: Record<string, number> = {}
  let idx = 0
  for (const p of children) {
    m[p] = idx++
  }
  folderOrder[parent] = m
  saveFolderOrder()
}

// 清空某个父目录下的自定义排序
export function clearFolderOrderForParent(parent: string) {
  try {
    if (folderOrder[parent]) delete folderOrder[parent]
    saveFolderOrder()
  } catch {}
}

function sep(p: string): string { return p.includes('\\') ? '\\' : '/' }
function norm(p: string): string { return p.replace(/[\\/]+/g, sep(p)) }
function join(a: string, b: string): string { const s = sep(a); return (a.endsWith(s) ? a : a + s) + b }
function base(p: string): string { return p.split(/[\\/]+/).slice(0, -1).join(sep(p)) }
function nameOf(p: string): string { const n = p.split(/[\\/]+/).pop() || p; return n }
function isInside(root: string, p: string): boolean { const r = norm(root).toLowerCase(); const q = norm(p).toLowerCase(); const s = r.endsWith(sep(r)) ? r : r + sep(r); return q.startsWith(s) }

async function ensureDir(dir: string) { try { await mkdir(dir, { recursive: true } as any) } catch {} }

async function moveFileSafe(src: string, dst: string): Promise<void> {
  try { await rename(src, dst) } catch {
    const data = await readFile(src)
    await ensureDir(base(dst))
    await writeFile(dst, data as any)
    try { await remove(src) } catch {}
  }
}

export async function newFileSafe(dir: string, hint = '新建文档.md'): Promise<string> {
  const s = sep(dir)
  let n = hint, i = 1
  while (await exists(dir + s + n)) {
    const m = hint.match(/^(.*?)(\.[^.]+)$/); const stem = m ? m[1] : hint; const ext = m ? m[2] : ''
    n = `${stem} ${++i}${ext}`
  }
  const full = dir + s + n
  await ensureDir(dir)
  await writeTextFile(full, '# 标题\n\n', {} as any)
  return full
}

export async function newFolderSafe(dir: string, hint = '新建文件夹'): Promise<string> {
  const s = sep(dir)
  let n = hint, i = 1
  while (await exists(dir + s + n)) { n = `${hint} ${++i}` }
  const full = dir + s + n
  await mkdir(full, { recursive: true } as any)
  // 创建一个占位文件，使文件夹在库侧栏中可见
  const placeholder = full + s + 'README.md'
  await writeTextFile(placeholder, '# ' + n + '\n\n', {} as any)
  return full
}

function saveSelection(path: string, isDir: boolean, row: HTMLElement) {
  state.selected = path
  state.selectedIsDir = isDir
  try {
    state.container?.querySelectorAll('.lib-node.selected').forEach(el => el.classList.remove('selected'))
  } catch {}
  row.classList.add('selected')
  state.opts?.onStateChange?.()
}

function clearDomSelection() {
  try {
    state.container?.querySelectorAll('.lib-node.selected').forEach(el => el.classList.remove('selected'))
  } catch {}
}

function findNodeByPath(path: string): HTMLElement | null {
  try {
    const root = state.container
    if (!root) return null
    const nodes = Array.from(root.querySelectorAll('.lib-node')) as HTMLElement[]
    for (const el of nodes) {
      if ((el as any)?.dataset?.path === path) return el
    }
  } catch {}
  return null
}

async function ensureDirExpanded(root: string, dirPath: string): Promise<void> {
  const row = findNodeByPath(dirPath)
  if (!row) return
  const kids = row.nextElementSibling as HTMLElement | null
  if (!kids || !kids.classList.contains('lib-children')) return

  // 展开目录：与点击行为一致（写入 expanded 状态 + 构建子节点）
  const alreadyExpanded = state.expanded.has(dirPath)
  if (!alreadyExpanded) setExpandedState(dirPath, true)
  try { row.classList.add('expanded') } catch {}
  try { kids.style.display = '' } catch {}
  if (kids.childElementCount === 0) {
    await buildDir(root, dirPath, kids)
  }
}

function normToSep(p: string, s: string): string {
  return String(p || '').replace(/[\\/]+/g, s)
}

function buildDirChain(root: string, targetDir: string): string[] {
  const s = sep(root)
  const r = normToSep(root, s)
  const t = normToSep(targetDir, s)
  const baseRoot = r.endsWith(s) ? r : r + s
  if (!t.toLowerCase().startsWith(baseRoot.toLowerCase())) return [r]
  const rel = t.slice(baseRoot.length)
  const parts = rel.split(s).filter(Boolean)
  const out: string[] = [r]
  let cur = r
  for (const part of parts) {
    cur = cur + s + part
    out.push(cur)
  }
  return out
}

async function revealAndSelect(path: string | null): Promise<void> {
  // 任何情况下都先清掉旧高亮，避免“假选中”
  clearDomSelection()

  const root = await state.opts?.getRoot?.()
  if (!root || !state.container) {
    state.selected = null
    state.selectedIsDir = false
    state.opts?.onStateChange?.()
    return
  }

  const p = (typeof path === 'string' && path.trim()) ? path : null
  if (!p) {
    state.selected = null
    state.selectedIsDir = false
    state.opts?.onStateChange?.()
    return
  }

  // 只同步库目录内的文件；外部文件不应在库侧栏里“乱指”
  if (!isInside(root, p)) {
    state.selected = null
    state.selectedIsDir = false
    state.opts?.onStateChange?.()
    return
  }

  // 先记录选中目标（用于后续刷新/重建时恢复）
  state.selected = p
  state.selectedIsDir = false

  // 逐级展开到目标父目录，确保目标行存在
  try {
    const chain = buildDirChain(root, base(p))
    for (const dir of chain) {
      await ensureDirExpanded(root, dir)
    }
  } catch {}

  // 尝试命中并选中（若仍找不到，至少不会残留旧高亮）
  const hit = findNodeByPath(p)
  if (hit) {
    try {
      saveSelection(p, false, hit)
      try { hit.scrollIntoView({ block: 'nearest' }) } catch {}
    } catch {}
  } else {
    state.opts?.onStateChange?.()
  }
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
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) return n
      if (typeof v === 'string') {
        const t = Date.parse(v)
        if (Number.isFinite(t)) return t
      }
      try { if (v instanceof Date) { const t = (v as Date).getTime(); if (Number.isFinite(t)) return t } } catch {}
    }
  } catch {}
  return 0
}

async function listDir(root: string, dir: string): Promise<{ name: string; path: string; isDir: boolean }[]> {
  const items: { name: string; path: string; isDir: boolean; mtime?: number; ext?: string }[] = []
  let ents: any[] = []
  try { ents = await readDir(dir, { recursive: false } as any) as any[] } catch { ents = [] }
  const dirs: { name: string; path: string; isDir: boolean; mtime?: number }[] = []
  // 仅展示指定后缀的文档（内置 + ASP 扩展）
  await ensureAdditionalSuffixCache()
  const allow = state.additionalSuffixAllow || new Set(['md', 'markdown', 'txt', 'pdf'])
  for (const it of ents) {
    const needMtime = (state.sortMode === 'mtime_asc' || state.sortMode === 'mtime_desc')
    const p: string = typeof it?.path === 'string' ? it.path : join(dir, it?.name || '')
    let isDir = !!(it as any)?.isDirectory
    let st: any = null
    if ((it as any)?.isDirectory === undefined) {
      try { st = await stat(p) as any; isDir = !!st?.isDirectory } catch { isDir = false }
    }
    if (!st && needMtime) {
      try { st = await stat(p) as any } catch {}
    }
    if (isDir) {
      // 仅保留“包含受支持文档(递归)”的目录
      if (await dirHasSupportedDocRecursive(p, allow)) {
        dirs.push({ name: nameOf(p), path: p, isDir: true, mtime: needMtime ? toMtimeMs(st) : undefined })
      }
    } else {
      const nm = nameOf(p)
      const ext = (nm.split('.').pop() || '').toLowerCase()
      if (allow.has(ext)) {
        items.push({ name: nm, path: p, isDir: false, mtime: needMtime ? toMtimeMs(st) : undefined, ext })
      }
    }
  }
  const isPdf = (e: any) => (e.ext || '').toLowerCase() === 'pdf'
  const pdfGrouped = (base: (a: any, b: any) => number) => (a: any, b: any) => {
    const ap = isPdf(a)
    const bp = isPdf(b)
    // pdf 永远成组：非 pdf 在前，pdf 在后
    if (ap && !bp) return 1
    if (!ap && bp) return -1
    return base(a, b)
  }

  const byNameAsc = (a: any, b: any) => a.name.localeCompare(b.name)
  const byNameDesc = (a: any, b: any) => -a.name.localeCompare(b.name)
  const byMtimeAsc = (a: any, b: any) => ((a.mtime ?? 0) - (b.mtime ?? 0)) || a.name.localeCompare(b.name)
  const byMtimeDesc = (a: any, b: any) => ((b.mtime ?? 0) - (a.mtime ?? 0)) || a.name.localeCompare(b.name)

  // 目录排序：手动顺序 + 原有规则
  const dirManualFirst = (cmp: (a: any, b: any) => number) => (a: any, b: any) => {
    const oa = getFolderOrder(dir, a.path)
    const ob = getFolderOrder(dir, b.path)
    const da = Number.isFinite(oa)
    const db = Number.isFinite(ob)
    if (da && !db) return -1
    if (!da && db) return 1
    if (da && db && oa !== ob) return oa - ob
    return cmp(a, b)
  }

  if (state.sortMode === 'name_asc') { dirs.sort(dirManualFirst(byNameAsc)); items.sort(pdfGrouped(byNameAsc)) }
  else if (state.sortMode === 'name_desc') { dirs.sort(dirManualFirst(byNameDesc)); items.sort(pdfGrouped(byNameDesc)) }
  else if (state.sortMode === 'mtime_asc') { dirs.sort(dirManualFirst(byMtimeAsc)); items.sort(pdfGrouped(byMtimeAsc)) }
  else if (state.sortMode === 'mtime_desc') { dirs.sort(dirManualFirst(byMtimeDesc)); items.sort(pdfGrouped(byMtimeDesc)) }
  else { dirs.sort(dirManualFirst(byNameAsc)); items.sort(pdfGrouped(byNameAsc)) }
  return [...dirs, ...items]
}

// 递归判断目录是否包含受支持文档（带缓存）
async function dirHasSupportedDocRecursive(dir: string, allow: Set<string>, depth = 20): Promise<boolean> {
  try {
    if (hasDocCache.has(dir)) return hasDocCache.get(dir) as boolean
    if (hasDocPending.has(dir)) return await (hasDocPending.get(dir) as Promise<boolean>)

    const p = (async (): Promise<boolean> => {
      if (depth <= 0) { hasDocCache.set(dir, false); return false }
      let entries: any[] = []
      try { entries = await readDir(dir, { recursive: false } as any) as any[] } catch { entries = [] }
      // 先扫描本层文件
      for (const it of (entries || [])) {
        const full: string = typeof it?.path === 'string' ? it.path : join(dir, it?.name || '')
        let isDir = false
         if ((it as any)?.isDirectory !== undefined) { isDir = !!(it as any)?.isDirectory } else { try { isDir = !!(await stat(full) as any)?.isDirectory } catch { isDir = false } }
        if (!isDir) {
          const nm = nameOf(full)
          const ext = (nm.split('.').pop() || '').toLowerCase()
          if (allow.has(ext)) { hasDocCache.set(dir, true); return true }
        }
      }
      // 再递归子目录
      for (const it of (entries || [])) {
        const full: string = typeof it?.path === 'string' ? it.path : join(dir, it?.name || '')
        let isDir = false
         if ((it as any)?.isDirectory !== undefined) { isDir = !!(it as any)?.isDirectory } else { try { isDir = !!(await stat(full) as any)?.isDirectory } catch { isDir = false } }
        if (isDir) {
          const ok = await dirHasSupportedDocRecursive(full, allow, depth - 1)
          if (ok) { hasDocCache.set(dir, true); return true }
        }
      }
      hasDocCache.set(dir, false)
      return false
    })()
    hasDocPending.set(dir, p)
    const r = await p
    hasDocPending.delete(dir)
    return r
  } catch { return false }
}

function makeTg(): HTMLElement { const s = document.createElementNS('http://www.w3.org/2000/svg','svg'); s.setAttribute('viewBox','0 0 24 24'); s.classList.add('lib-tg'); const p=document.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('d','M9 6l6 6-6 6'); s.appendChild(p); return s as any }

// 轻量线条文件夹图标（Lucide 风格）
function makeFolderSvg(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.classList.add('lib-ico', 'lib-ico-svg', 'lib-ico-folder')
  // Lucide folder 图标
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '2')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.appendChild(path)
  return svg
}

// 房子/Home 图标（用于顶级库）
function makeLibrarySvg(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.classList.add('lib-ico', 'lib-ico-svg', 'lib-ico-library')
  // Lucide home 图标
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '2')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.appendChild(path)
  // 门
  const door = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  door.setAttribute('d', 'M9 22V12h6v10')
  door.setAttribute('fill', 'none')
  door.setAttribute('stroke', 'currentColor')
  door.setAttribute('stroke-width', '2')
  door.setAttribute('stroke-linecap', 'round')
  door.setAttribute('stroke-linejoin', 'round')
  svg.appendChild(door)
  return svg
}

// VS Code 风格 SVG 图标：普通文件（文档带折角）
function makeFileSvg(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.classList.add('lib-ico', 'lib-ico-svg', 'lib-ico-file')
  // 文档形状：带右上角折角
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M3 1.5h6.5l3 3v10h-9.5v-13z M9.5 1.5v3h3')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1')
  path.setAttribute('stroke-linejoin', 'round')
  svg.appendChild(path)
  return svg
}

// VS Code 风格 SVG 图标：PDF 文件（右下角突出徽章）
function makePdfSvg(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.classList.add('lib-ico', 'lib-ico-svg', 'lib-ico-pdf')
  // 文档形状（稍微缩短以给徽章留空间）
  const docPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  docPath.setAttribute('d', 'M3 1.5h6.5l3 3v8h-9.5v-11z M9.5 1.5v3h3')
  docPath.setAttribute('fill', 'none')
  docPath.setAttribute('stroke', 'currentColor')
  docPath.setAttribute('stroke-width', '1')
  docPath.setAttribute('stroke-linejoin', 'round')
  svg.appendChild(docPath)
  // 右下角突出徽章
  const badge = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  badge.setAttribute('x', '7')
  badge.setAttribute('y', '10')
  badge.setAttribute('width', '8')
  badge.setAttribute('height', '5')
  badge.setAttribute('rx', '1')
  badge.setAttribute('fill', 'currentColor')
  badge.classList.add('pdf-badge')
  svg.appendChild(badge)
  // PDF 文字（反白）
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  text.setAttribute('x', '11')
  text.setAttribute('y', '13.5')
  text.setAttribute('font-size', '3.5')
  text.setAttribute('font-weight', 'bold')
  text.setAttribute('text-anchor', 'middle')
  text.classList.add('pdf-text')
  text.textContent = 'PDF'
  svg.appendChild(text)
  return svg
}

// 文件夹图标：顶级库使用书架图标，普通文件夹使用实心文件夹
function makeFolderIcon(_path?: string, isRoot?: boolean): HTMLElement {
  if (isRoot) {
    return makeLibrarySvg() as unknown as HTMLElement
  }
  return makeFolderSvg() as unknown as HTMLElement
}

// 移除文件后缀名（用于简洁显示）
function stripExt(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx > 0 ? name.slice(0, idx) : name
}

async function buildDir(root: string, dir: string, parent: HTMLElement) {
  parent.innerHTML = ''
  const entries = await listDir(root, dir)
  const dirEntries = entries.filter(e => e.isDir)
  const fileEntries = entries.filter(e => !e.isDir)

  // 目录行构建时，需要知道同级目录的顺序，用于拖拽排序后重写 folderOrder
  const allDirPaths = dirEntries.map(e => e.path)

  for (const e of [...dirEntries, ...fileEntries]) {
    const row = document.createElement('div')
    row.className = 'lib-node ' + (e.isDir ? 'lib-dir' : 'lib-file')
    ;(row as any).dataset.path = e.path
    const label = document.createElement('span')
    label.className = 'lib-name'
    // 文件隐藏后缀名，文件夹保持原名
    label.textContent = e.isDir ? e.name : stripExt(e.name)

    if (e.isDir) {
      const tg = makeTg()
      const ico = makeFolderIcon(e.path)
      row.appendChild(tg); row.appendChild(ico); row.appendChild(label)
      const kids = document.createElement('div')
      kids.className = 'lib-children'
      kids.style.display = 'none'
      parent.appendChild(row)
      parent.appendChild(kids)

      const exp = state.expanded.has(e.path)
      if (exp) { kids.style.display = ''; row.classList.add('expanded'); await buildDir(root, e.path, kids) }

      row.addEventListener('click', async (ev) => {
        const was = state.expanded.has(e.path)
        if (ev.detail === 2) return
        saveSelection(e.path, true, row)
        const now = !was
        setExpandedState(e.path, now)
        kids.style.display = now ? '' : 'none'
        row.classList.toggle('expanded', now)
        if (now && kids.childElementCount === 0) await buildDir(root, e.path, kids)
      })

      // 目录同级内部拖拽排序（仅作用于显示顺序，不移动真实文件）
      ;(() => {
        let down = false
        let sx = 0, sy = 0
        let moved = false
        let ghost: HTMLDivElement | null = null
        let hoverRow: HTMLElement | null = null

        const onMouseMove = (ev: MouseEvent) => {
          if (!down) return
          const dx = ev.clientX - sx
          const dy = ev.clientY - sy
          if (!moved && Math.hypot(dx, dy) > 6) {
            moved = true
            ghost = document.createElement('div')
            ghost.className = 'ft-ghost'
            const gico = document.createElement('span')
            gico.className = 'lib-ico lib-ico-folder'
            gico.style.marginRight = '6px'
            gico.style.color = '#fff'
            const glab = document.createElement('span')
            glab.textContent = e.name
            glab.style.fontSize = '12px'
            ghost.appendChild(gico)
            ghost.appendChild(glab)
            ghost.style.position = 'fixed'
            ghost.style.left = ev.clientX + 8 + 'px'
            ghost.style.top = ev.clientY + 8 + 'px'
            ghost.style.padding = '6px 10px'
            ghost.style.background = 'rgba(17,17,17,0.85)'
            ghost.style.color = '#fff'
            ghost.style.borderRadius = '8px'
            ghost.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)'
            ghost.style.pointerEvents = 'none'
            ghost.style.zIndex = '99999'
            document.body.appendChild(ghost)
            try { document.body.style.userSelect = 'none' } catch {}
          }
          if (moved && ghost) {
            ghost.style.left = ev.clientX + 8 + 'px'
            ghost.style.top = ev.clientY + 8 + 'px'
            const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
            const rowEl = el?.closest?.('.lib-node.lib-dir') as HTMLElement | null
            if (hoverRow && hoverRow !== rowEl) hoverRow.classList.remove('selected')
            if (rowEl) rowEl.classList.add('selected')
            hoverRow = rowEl
          }
        }

        const cleanup = () => {
          document.removeEventListener('mousemove', onMouseMove)
          document.removeEventListener('mouseup', onMouseUp, true)
          down = false
          moved = false
          if (ghost && ghost.parentElement) ghost.parentElement.removeChild(ghost)
          ghost = null
          if (hoverRow) hoverRow.classList.remove('selected')
          hoverRow = null
          try { document.body.style.userSelect = '' } catch {}
        }

        const onMouseUp = async (ev: MouseEvent) => {
          try {
            if (!moved) return
            ev.preventDefault()
            ev.stopPropagation()
            const target = hoverRow
            if (!target) return
            const targetPath = (target as any).dataset?.path as string | undefined
            if (!targetPath || targetPath === e.path) return
            const before = allDirPaths.slice()
            const srcIdx = before.indexOf(e.path)
            const dstIdx = before.indexOf(targetPath)
            if (srcIdx === -1 || dstIdx === -1) return
            before.splice(srcIdx, 1)
            before.splice(dstIdx, 0, e.path)
            setFolderOrderForParent(dir, before)
            await refresh()
          } finally {
            cleanup()
          }
        }

        row.addEventListener('mousedown', (ev) => {
          if (ev.button !== 0) return
          // Ctrl/Shift 等组合键保留给选择，避免误启动排序拖拽
          if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return
          // 在目录节点上按住左键，启动排序拖拽准备
          down = true
          moved = false
          sx = ev.clientX
          sy = ev.clientY
          document.addEventListener('mousemove', onMouseMove)
          document.addEventListener('mouseup', onMouseUp, true)
        }, true)
      })()

      row.addEventListener('dragover', (ev) => {
        ev.preventDefault()
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'
        row.classList.add('selected')
        console.log('[拖动] 拖动到文件夹:', e.path)
      })
      // 一些平台需要在 dragenter 同样 preventDefault，才能从“禁止”光标切到可放置
      row.addEventListener('dragenter', (ev) => { try { ev.preventDefault(); if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'; row.classList.add('selected') } catch {} })
      row.addEventListener('dragleave', () => { row.classList.remove('selected') })
      row.addEventListener('drop', async (ev) => {
        try {
          ev.preventDefault(); row.classList.remove('selected')
          console.log('[拖动] Drop事件触发，目标文件夹:', e.path)
          const src = ev.dataTransfer?.getData('text/plain') || ''
          if (!src) return
          const dst = join(e.path, nameOf(src))
          if (src === dst) return
          if (!isInside(root, src) || !isInside(root, dst)) return alert(t('ft.move.within'))
          let finalDst = dst
          if (await exists(dst)) {
            const choice = await conflictModal(t('ft.exists'), [t('action.overwrite'), t('action.renameAuto'), t('action.cancel')], 1)
            if (choice === 2) return
            if (choice === 1) {
              const nm = nameOf(src)
              const stem = nm.replace(/(\.[^.]+)$/,''); const ext = nm.match(/(\.[^.]+)$/)?.[1] || ''
              let i=1, cand=''
              do { cand = `${stem} ${++i}${ext}` } while (await exists(join(e.path, cand)))
              finalDst = join(e.path, cand)
              await moveFileSafe(src, finalDst)
            } else {
              await moveFileSafe(src, dst)
            }
          } else {
            await moveFileSafe(src, dst)
          }
          try { await state.opts?.onMoved?.(src, finalDst) } catch {}
          await refresh()
          console.log('[拖动] 移动完成:', src, '→', finalDst)
        } catch (err) { console.error('[拖动] 移动失败:', err) }
      })
    } else {
      // 为文件显示 VS Code 风格的黑白 SVG 图标
      const ext = (() => { try { return (e.name.split('.').pop() || '').toLowerCase() } catch { return '' } })()
      let iconEl: HTMLElement
      // 根据扩展名选择图标：PDF 使用专用图标；ASP 可为额外后缀指定 icon=pdf
      const aspIcon = (() => {
        try {
          const meta = state.additionalSuffixMeta || {}
          return meta[ext]?.icon
        } catch {
          return undefined
        }
      })()
      if (ext === 'pdf' || aspIcon === 'pdf') iconEl = makePdfSvg() as unknown as HTMLElement
      else iconEl = makeFileSvg() as unknown as HTMLElement
      // 让图标与文字都成为可拖拽起点（某些内核仅触发“被按住元素”的拖拽，不会透传到父元素）
      try { iconEl.setAttribute('draggable', 'true') } catch {}
      try { label.setAttribute('draggable', 'true') } catch {}
      // 统一的拖拽启动处理（Edge/WebView2 兼容：设置 dataTransfer 与拖拽影像）
      let nativeDragStarted = false
      const startDrag = (ev: DragEvent) => {
        try {
          ev.stopPropagation()
          const dt = ev.dataTransfer
          if (!dt) return
          nativeDragStarted = true
          // 必须至少写入一种类型的数据，否则某些内核会判定为“无效拖拽”
          dt.setData('text/plain', e.path)
          // 兼容某些解析器：附带 URI 列表
          try {
            const fileUrl = (() => {
              try {
                const p = e.path.replace(/\\/g, '/').replace(/^([A-Za-z]):\//, 'file:///$1:/')
                return p.startsWith('file:///') ? p : ('file:///' + p.replace(/^\//, ''))
              } catch { return '' }
            })()
            if (fileUrl) dt.setData('text/uri-list', fileUrl)
          } catch {}
          // 允许移动/复制（由目标决定 dropEffect）
          dt.effectAllowed = 'copyMove'
          // 提供拖拽影像，避免出现无预览时的“禁止”提示
          try { dt.setDragImage(row, 4, 4) } catch {}
        } catch {}
      }
      row.addEventListener('dragstart', startDrag)
      iconEl.addEventListener('dragstart', startDrag as any)
      label.addEventListener('dragstart', startDrag as any)
      // 自绘拖拽兜底：在某些 WebView2 场景下，原生 DnD 会一直显示禁止图标，
      // 我们在移动阈值触发后启用自绘拖拽，模拟“拖到文件夹释放即可移动”。
      const setupFallbackDrag = (host: HTMLElement) => {
        let down = false, sx = 0, sy = 0, moved = false
        let ghost: HTMLDivElement | null = null
        let hoverEl: HTMLElement | null = null
        let prevRowDraggable: string | null = null
        let prevIconDraggable: string | null = null
        let prevLabelDraggable: string | null = null
        const suppressClick = (ev: MouseEvent) => { if (moved) { ev.stopImmediatePropagation(); ev.preventDefault() } }
        const restoreDraggable = () => {
          try { if (prevRowDraggable !== null) row.setAttribute('draggable', prevRowDraggable); else row.removeAttribute('draggable') } catch {}
          try { if (prevIconDraggable !== null) (iconEl as any).setAttribute('draggable', prevIconDraggable); else (iconEl as any).removeAttribute('draggable') } catch {}
          try { if (prevLabelDraggable !== null) label.setAttribute('draggable', prevLabelDraggable); else label.removeAttribute('draggable') } catch {}
        }
        const onMove = (ev: MouseEvent) => {
          if (!down) return
          // 若原生拖拽已经启动，放弃兜底
          if (nativeDragStarted) { cleanup(); return }
          const dx = ev.clientX - sx, dy = ev.clientY - sy
          if (!moved && Math.hypot(dx, dy) > 6) {
            moved = true
            ghost = document.createElement('div')
            ghost.className = 'ft-ghost'
            // 图标
            const gico = document.createElement('span')
            gico.className = 'lib-ico lib-ico-file'
            gico.style.color = '#fff'
            gico.style.marginRight = '6px'
            // 文本
            const glab = document.createElement('span')
            glab.textContent = e.name
            glab.style.fontSize = '12px'
            // 组合
            ghost.appendChild(gico)
            ghost.appendChild(glab)
            // 位置与通用样式（兜底）
            ghost.style.position = 'fixed'
            ghost.style.left = ev.clientX + 8 + 'px'
            ghost.style.top = ev.clientY + 8 + 'px'
            ghost.style.padding = '6px 10px'
            ghost.style.background = 'rgba(17,17,17,0.85)'
            ghost.style.color = '#fff'
            ghost.style.borderRadius = '8px'
            ghost.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)'
            ghost.style.pointerEvents = 'none'
            ghost.style.zIndex = '99999'
            document.body.appendChild(ghost)
            try { document.body.style.cursor = 'grabbing' } catch {}
            try { document.body.style.userSelect = 'none' } catch {}
          }
          if (moved && ghost) {
            ghost.style.left = ev.clientX + 8 + 'px'
            ghost.style.top = ev.clientY + 8 + 'px'
            // 命中测试：查找鼠标下的目录节点
            let el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
            let tgt = el?.closest?.('.lib-node.lib-dir') as HTMLElement | null
            if (hoverEl && hoverEl !== tgt) hoverEl.classList.remove('selected')
            if (tgt) tgt.classList.add('selected')
            hoverEl = tgt
          }
          try { ev.preventDefault() } catch {}
        }
        const finish = async () => {
          try {
            const base = (hoverEl as any)?.dataset?.path as string | undefined
            if (!moved || !base) return
            const root = await state.opts!.getRoot()
            if (!root) return
            const dst = join(base, nameOf(e.path))
            if (e.path === dst) return
            if (!isInside(root, e.path) || !isInside(root, dst)) { alert(t('ft.move.within')); return }
            let finalDst = dst
            if (await exists(dst)) {
              try { if (ghost) ghost.style.display = 'none' } catch {}
              const choice = await conflictModal(t('ft.exists'), [t('action.overwrite'), t('action.renameAuto'), t('action.cancel')], 1)
              if (choice === 2) return
              if (choice === 1) {
                const nm = nameOf(e.path)
                const stem = nm.replace(/(\.[^.]+)$/,''); const ext = nm.match(/(\.[^.]+)$/)?.[1] || ''
                let i=1, cand=''
                do { cand = `${stem} ${++i}${ext}` } while (await exists(join(base, cand)))
                finalDst = join(base, cand)
                await moveFileSafe(e.path, finalDst)
              } else {
                await moveFileSafe(e.path, dst)
              }
            } else {
              await moveFileSafe(e.path, dst)
            }
            try { await state.opts?.onMoved?.(e.path, finalDst) } catch {}
            await refresh()
          } catch (err) { console.error('[拖动] 兜底移动失败:', err) }
        }
        const cleanup = () => {
          document.removeEventListener('mousemove', onMove)
          down = false
          moved = false
          try { if (ghost && ghost.parentElement) ghost.parentElement.removeChild(ghost) } catch {}
          try { document.querySelectorAll('.ft-ghost').forEach((el) => { try { (el as any).parentElement?.removeChild(el) } catch {} }) } catch {}
          try { document.body.style.cursor = '' } catch {}
          try { document.body.style.userSelect = '' } catch {}
          ghost = null
          if (hoverEl) hoverEl.classList.remove('selected')
          hoverEl = null
          try { host.removeEventListener('click', suppressClick, true) } catch {}
          restoreDraggable()
        }
        const onDown = (ev: MouseEvent) => {
          if (ev.button !== 0) return
          // 允许文本选择/点击，不阻止默认；兜底触发依靠移动阈值
          down = true; sx = ev.clientX; sy = ev.clientY; moved = false; nativeDragStarted = false
          try { ev.stopPropagation() } catch {}
          // 暂时禁用原生 DnD，避免阻断 mousemove
          try {
            prevRowDraggable = row.getAttribute('draggable')
            prevIconDraggable = (iconEl as any).getAttribute?.('draggable') ?? null
            prevLabelDraggable = label.getAttribute('draggable')
            row.removeAttribute('draggable')
            // 注意：<img> 默认 draggable=true，removeAttribute 会回到默认值，反而禁不掉；
            // 这里必须显式设置为 false 才能阻止原生拖拽抢走 mousemove。
            ;(iconEl as any).setAttribute?.('draggable', 'false')
            label.removeAttribute('draggable')
          } catch {}
          try { host.addEventListener('click', suppressClick, true) } catch {}
          document.addEventListener('mousemove', onMove)
          const onUp = async () => { document.removeEventListener('mouseup', onUp); if (!nativeDragStarted) { await finish() } cleanup() }
          document.addEventListener('mouseup', onUp, { once: true })
        }
        host.addEventListener('mousedown', onDown, true)
      }
      // 将兜底拖拽仅绑定到整行，避免多次绑定造成多个“幽灵”遗留
      setupFallbackDrag(row)
      row.appendChild(iconEl); row.appendChild(label)
      try { if (ext) row.classList.add('file-ext-' + ext) } catch {}

      // 单击加载文档并保持选中；支持 Ctrl+左键在新标签中打开并进入源码模式
      row.addEventListener('click', async (ev) => {
        try {
          // 忽略非左键点击，以及双击序列中的第二次点击（交给 dblclick 处理）
          if (ev.button !== 0 || ev.detail > 1) return
        } catch {}

        saveSelection(e.path, false, row)

        const isCtrlLike = !!(ev.ctrlKey || ev.metaKey)
        const win = (window as any)
        const hasFlyOpen = !!(win && typeof win.flymdOpenFile === 'function')

        // Ctrl+左键：通过全局 flymdOpenFile（带标签系统）打开，并在需要时模拟 Ctrl+E 进入源码模式
        if (isCtrlLike && hasFlyOpen) {
          ev.preventDefault()
          try { ev.stopPropagation() } catch {}
          const getPath = () => {
            try { return typeof win.flymdGetCurrentFilePath === 'function' ? win.flymdGetCurrentFilePath() : null } catch { return null }
          }
          const beforePath = getPath()
          try {
            await win.flymdOpenFile(e.path)
          } catch {
            // 回退到原有回调，避免功能完全失效
            try { await state.opts?.onOpenFile(e.path) } catch {}
          }

          const afterPath = getPath()
          const getMode = () => {
            try { return typeof win.flymdGetMode === 'function' ? win.flymdGetMode() : null } catch { return null }
          }
          const getWysiwyg = () => {
            try { return typeof win.flymdGetWysiwygEnabled === 'function' ? !!win.flymdGetWysiwygEnabled() : false } catch { return false }
          }

          // 仅在“真正切换到了目标文档”且当前不在纯文本编辑态时，才模拟 Ctrl+E 逻辑
          const shouldToggle =
            afterPath && afterPath === e.path && afterPath !== beforePath &&
            (getMode() !== 'edit' || getWysiwyg())

          if (shouldToggle && typeof win.flymdToggleModeShortcut === 'function') {
            try { await win.flymdToggleModeShortcut() } catch {}
          }
          return
        }

        // 普通单击：若多标签系统已挂钩，则通过 flymdOpenFile 打开；否则沿用旧行为
        if (hasFlyOpen) {
          try {
            await win.flymdOpenFile(e.path)
          } catch {
            try { await state.opts?.onOpenFile(e.path) } catch {}
          }
        } else {
          try { await state.opts?.onOpenFile(e.path) } catch {}
        }
      })
      // 双击加载，兼容旧习惯；同样优先走 flymdOpenFile（若存在）
      row.addEventListener('dblclick', async (ev) => {
        try {
          if (ev.button !== 0) return
        } catch {}
        const win = (window as any)
        const hasFlyOpen = !!(win && typeof win.flymdOpenFile === 'function')
        if (hasFlyOpen) {
          try {
            await win.flymdOpenFile(e.path)
          } catch {
            try { await state.opts?.onOpenFile(e.path) } catch {}
          }
        } else {
          try { await state.opts?.onOpenFile(e.path) } catch {}
        }
      })

      row.setAttribute('draggable','true')

      parent.appendChild(row)
    }
  }
}

async function renderRoot(root: string) {
  if (!state.container) return
  state.container.innerHTML = ''
  const topRow = document.createElement('div')
  topRow.className = 'lib-node lib-dir'
  ;(topRow as any).dataset.path = root
  const tg = makeTg(); const ico = makeFolderIcon(root, true); const label = document.createElement('span'); label.className='lib-name'; label.textContent = nameOf(root) || root
  topRow.appendChild(tg); topRow.appendChild(ico); topRow.appendChild(label)
  const kids = document.createElement('div')
  kids.className = 'lib-children'
  state.container.appendChild(topRow)
  state.container.appendChild(kids)
  const rootExpanded = state.expanded.has(root)
  topRow.classList.toggle('expanded', rootExpanded)
  kids.style.display = rootExpanded ? '' : 'none'
  if (rootExpanded) await buildDir(root, root, kids)

  // 刷新后恢复选中态
  try {
    if (state.selected) {
      const all = Array.from(state.container.querySelectorAll('.lib-node')) as HTMLElement[]
      const hit = all.find((el) => (el as any).dataset?.path === state.selected)
      if (hit) { hit.classList.add('selected') }
    }
  } catch {}

  // 根节点的拖放处理
  topRow.addEventListener('dragover', (ev) => {
    ev.preventDefault()
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'
    topRow.classList.add('selected')
    console.log('[拖动] 拖动到根文件夹:', root)
  })
  topRow.addEventListener('dragenter', (ev) => { try { ev.preventDefault(); if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'; topRow.classList.add('selected') } catch {} })
  topRow.addEventListener('dragleave', () => { topRow.classList.remove('selected') })
  topRow.addEventListener('drop', async (ev) => {
    try {
      ev.preventDefault(); topRow.classList.remove('selected')
      const src = ev.dataTransfer?.getData('text/plain') || ''
      if (!src) return
      const dst = join(root, nameOf(src))
      if (src === dst) return
      if (!isInside(root, src) || !isInside(root, dst)) return alert(t('ft.move.within'))
      let finalDst = dst
      if (await exists(dst)) {
        const choice = await conflictModal(t('ft.exists'), [t('action.overwrite'), t('action.renameAuto'), t('action.cancel')], 1)
        if (choice === 2) return
        if (choice === 1) {
          const nm = nameOf(src)
          const stem = nm.replace(/(\.[^.]+)$/,''); const ext = nm.match(/(\.[^.]+)$/)?.[1] || ''
          let i=1, cand=''
          do { cand = `${stem} ${++i}${ext}` } while (await exists(join(root, cand)))
          finalDst = join(root, cand)
          await moveFileSafe(src, finalDst)
        } else {
          await moveFileSafe(src, dst)
        }
      } else {
        await moveFileSafe(src, dst)
      }
      try { await state.opts?.onMoved?.(src, finalDst) } catch {}
      await refresh()
      console.log('[拖动] 移动完成:', src, '→', finalDst)
    } catch (err) { console.error('[拖动] 移动失败:', err) }
  })

  topRow.addEventListener('click', async () => {
    const was = state.expanded.has(root)
    const now = !was
    setExpandedState(root, now)
    kids.style.display = now ? '' : 'none'
    topRow.classList.toggle('expanded', now)
    if (now && kids.childElementCount === 0) await buildDir(root, root, kids)
  })
}

// 内部刷新函数，不重新设置监听
async function refreshTree() {
  const root = await state.opts!.getRoot()
  if (!root) {
    if (state.container) state.container.innerHTML = ''
    state.additionalSuffixMeta = null
    state.additionalSuffixAllow = null
    return
  }
  state.currentRoot = root
  restoreExpandedState(root)
  await updateAdditionalSuffixCache()
  // 刷新前清理目录缓存，确保显示与实际文件状态一致
  try { hasDocCache.clear(); hasDocPending.clear() } catch {}
  await renderRoot(root)
}

async function refresh() {
  const root = await state.opts!.getRoot()
  // 若未选择库目录，不再在侧栏显示提示，保持空白即可，避免误导用户
  if (!root) {
    state.currentRoot = null
    state.expanded = new Set<string>()
    state.additionalSuffixMeta = null
    state.additionalSuffixAllow = null
    if (state.container) state.container.innerHTML = ''
    // 清理旧的监听器
    if (state.unwatch) {
      try { state.unwatch() } catch {}
      state.unwatch = null
      state.watching = false
    }
    resetWatchRefreshScheduler()
    return
  }

  // 如果库根目录改变了，需要重新设置监听
  if (state.currentRoot !== root) {
    if (state.unwatch) {
      try { state.unwatch() } catch {}
      state.unwatch = null
      state.watching = false
    }
    resetWatchRefreshScheduler()
  }

  state.currentRoot = root
  restoreExpandedState(root)
  await updateAdditionalSuffixCache()
  // 刷新前清理目录缓存，确保显示与实际文件状态一致
  try { hasDocCache.clear(); hasDocPending.clear() } catch {}
  await renderRoot(root)

    // 设置文件监听（如果还未设置或根目录改变了）
    if (!state.watching) {
      try {
        const u = await watch(root, async (event) => {
          if (!isRelevantWatchEvent(event)) return
          scheduleRefreshTreeFromWatch()
        }, { recursive: true, delayMs: 250 } as any)
        state.unwatch = () => { try { u(); } catch {} }
        state.watching = true
        console.log('[文件树] 已启动文件监听:', root)
      } catch (err) {
        console.error('[文件树] 启动文件监听失败:', err)
        console.log('[文件树] 注意: 文件系统监听不可用，需要手动刷新或使用插件提供的刷新功能')
        // 监听失败时不要把 watching 置为 true，保持为 false，方便后续 refresh() 重试
        state.watching = false
        resetWatchRefreshScheduler()
      }
    }
  }

async function init(container: HTMLElement, opts: FileTreeOptions) {
  state.container = container; state.opts = opts
  loadFolderOrder()
  // 兜底：在整个文件树区域内允许 dragover，避免出现全局"禁止"光标
  try {
    container.addEventListener('dragover', (ev) => { ev.preventDefault() })
  } catch {}
  await refresh()
  // 文件监听已经在 refresh() 函数中自动设置
}

async function newFileInSelected() {
  const root = await state.opts!.getRoot()
  if (!root) return
  const dir = state.selectedIsDir ? (state.selected || root) : base(state.selected || root)
  const p = await newFileSafe(dir)
  if (state.opts?.onOpenNewFile) await state.opts.onOpenNewFile(p); else await state.opts!.onOpenFile(p)
  await refresh()
}

async function newFolderInSelected() {
  const root = await state.opts!.getRoot(); if (!root) return
  const dir = state.selectedIsDir ? (state.selected || root) : base(state.selected || root)
  await newFolderSafe(dir)
  await refresh()
}

async function conflictModal(title: string, actions: string[], defaultIndex = 1): Promise<number> {
  return await new Promise<number>((resolve) => {
    try {
      let dom = document.getElementById('ft-modal') as HTMLDivElement | null
      if (!dom) {
        dom = document.createElement('div'); dom.id='ft-modal'; dom.style.position='fixed'; dom.style.inset='0'; dom.style.background='rgba(0,0,0,0.35)'; dom.style.display='flex'; dom.style.alignItems='center'; dom.style.justifyContent='center'; dom.style.zIndex='9999'
        const box = document.createElement('div'); box.className='ft-box'; box.style.background='var(--bg)'; box.style.color='var(--fg)'; box.style.border='1px solid var(--border)'; box.style.borderRadius='12px'; box.style.boxShadow='0 12px 36px rgba(0,0,0,0.2)'; box.style.minWidth='320px'; box.style.maxWidth='80vw'
        const hd = document.createElement('div'); hd.style.padding='12px 16px'; hd.style.fontWeight='600'; hd.style.borderBottom='1px solid var(--border)'; box.appendChild(hd)
        const bd = document.createElement('div'); bd.style.padding='14px 16px'; box.appendChild(bd)
        const ft = document.createElement('div'); ft.style.display='flex'; ft.style.gap='8px'; ft.style.justifyContent='flex-end'; ft.style.padding='8px 12px'; ft.style.borderTop='1px solid var(--border)'; box.appendChild(ft)
        dom.appendChild(box)
        document.body.appendChild(dom)
      }
      const box = dom.firstElementChild as HTMLDivElement
      const hd = box.children[0] as HTMLDivElement
      const bd = box.children[1] as HTMLDivElement
      const ft = box.children[2] as HTMLDivElement
      hd.textContent = title
      bd.textContent = t('ft.conflict.prompt')
      ft.innerHTML = ''
      actions.forEach((txt, idx) => {
        const b = document.createElement('button') as HTMLButtonElement
        b.textContent = txt
        b.style.border='1px solid var(--border)'; b.style.borderRadius='8px'; b.style.padding='6px 12px'; b.style.background= idx===defaultIndex ? '#2563eb' : 'rgba(127,127,127,0.08)'; b.style.color = idx===defaultIndex ? '#fff' : 'var(--fg)'
        b.addEventListener('click', () => { dom!.style.display='none'; resolve(idx) })
        ft.appendChild(b)
      })
      dom.style.display='flex'
    } catch { resolve(defaultIndex) }
  })
}

export const fileTree: FileTreeAPI = {
  init, refresh,
  revealAndSelect,
  getSelectedDir: () => (state.selectedIsDir ? (state.selected || null) : (state.selected ? base(state.selected) : null)),
  newFileInSelected, newFolderInSelected,
  setSort: (mode) => { state.sortMode = mode },
}

export default fileTree
