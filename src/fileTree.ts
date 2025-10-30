import { readDir, stat, mkdir, rename, remove, exists, writeTextFile, writeFile, readFile, watchImmediate } from '@tauri-apps/plugin-fs'
import appIconUrl from '../flymd.png?url'

export type FileTreeOptions = {
  // 获取库根目录（未设置时返回 null）
  getRoot: () => Promise<string | null>
  // 打开已有文件（双击文件触发）
  onOpenFile: (path: string) => Promise<void> | void
  // 新建文件后打开（用于默认进入编辑态）
  onOpenNewFile?: (path: string) => Promise<void> | void
  // 状态变更回调（选中/展开变化时可通知外层）
  onStateChange?: () => void
}

export type FileTreeAPI = {
  init: (container: HTMLElement, opts: FileTreeOptions) => Promise<void>
  refresh: () => Promise<void>
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
}

// 目录递归包含受支持文档的缓存
const hasDocCache = new Map<string, boolean>()
const hasDocPending = new Map<string, Promise<boolean>>()

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

async function newFileSafe(dir: string, hint = '新建文档.md'): Promise<string> {
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

async function newFolderSafe(dir: string, hint = '新建文件夹'): Promise<string> {
  const s = sep(dir)
  let n = hint, i = 1
  while (await exists(dir + s + n)) { n = `${hint} ${++i}` }
  const full = dir + s + n
  await mkdir(full, { recursive: true } as any)
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
  const items: { name: string; path: string; isDir: boolean; mtime?: number }[] = []
  let ents: any[] = []
  try { ents = await readDir(dir, { recursive: false } as any) as any[] } catch { ents = [] }
  const dirs: { name: string; path: string; isDir: boolean; mtime?: number }[] = []
  // 仅展示指定后缀的文档（md / markdown / txt / pdf）
  const allow = new Set(['md', 'markdown', 'txt', 'pdf'])
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
       if (allow.has(ext)) items.push({ name: nm, path: p, isDir: false, mtime: needMtime ? toMtimeMs(st) : undefined })
    }
  }
  const byNameAsc = (a: any, b: any) => a.name.localeCompare(b.name)
  const byNameDesc = (a: any, b: any) => -a.name.localeCompare(b.name)
  const byMtimeAsc = (a: any, b: any) => ((a.mtime ?? 0) - (b.mtime ?? 0))
  const byMtimeDesc = (a: any, b: any) => ((b.mtime ?? 0) - (a.mtime ?? 0))

  if (state.sortMode === 'name_asc') { dirs.sort(byNameAsc); items.sort(byNameAsc) }
  else if (state.sortMode === 'name_desc') { dirs.sort(byNameDesc); items.sort(byNameDesc) }
  else if (state.sortMode === 'mtime_asc') { dirs.sort(byMtimeAsc); items.sort(byMtimeAsc) }
  else if (state.sortMode === 'mtime_desc') { dirs.sort(byMtimeDesc); items.sort(byMtimeDesc) }
  else { dirs.sort(byNameAsc); items.sort(byNameAsc) }
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
function makeFolderIcon(): HTMLElement { const s=document.createElementNS('http://www.w3.org/2000/svg','svg'); s.setAttribute('viewBox','0 0 24 24'); s.classList.add('lib-ico','lib-ico-folder'); const p=document.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('d','M3 7a 2 2 0 0 1 2-2h4l2 2h8a 2 2 0 0 1 2 2v7a 2 2 0 0 1-2 2H5a 2 2 0 0 1-2-2V7z'); s.appendChild(p); return s as any }

async function buildDir(root: string, dir: string, parent: HTMLElement) {
  parent.innerHTML = ''
  const entries = await listDir(root, dir)
  for (const e of entries) {
    const row = document.createElement('div')
    row.className = 'lib-node ' + (e.isDir ? 'lib-dir' : 'lib-file')
    ;(row as any).dataset.path = e.path
    const label = document.createElement('span')
    label.className = 'lib-name'
    label.textContent = e.name

    if (e.isDir) {
      const tg = makeTg()
      const ico = makeFolderIcon()
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
        state.expanded[now ? 'add' : 'delete'](e.path)
        kids.style.display = now ? '' : 'none'
        row.classList.toggle('expanded', now)
        if (now && kids.childElementCount === 0) await buildDir(root, e.path, kids)
      })

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
          if (!isInside(root, src) || !isInside(root, dst)) return alert('仅允许在库目录内移动')
          if (await exists(dst)) {
            const choice = await conflictModal('目标已存在', ['覆盖', '自动改名', '取消'], 1)
            if (choice === 2) return
            if (choice === 1) {
              const nm = nameOf(src)
              const stem = nm.replace(/(\.[^.]+)$/,''); const ext = nm.match(/(\.[^.]+)$/)?.[1] || ''
              let i=1, cand=''
              do { cand = `${stem} ${++i}${ext}` } while (await exists(join(e.path, cand)))
              await moveFileSafe(src, join(e.path, cand))
            } else {
              await moveFileSafe(src, dst)
            }
          } else {
            await moveFileSafe(src, dst)
          }
          await api.refresh()
      try { (window as any).flymdScheduleSync?.() } catch {}
          console.log('[拖动] 移动完成:', src, '→', dst)
        } catch (err) { console.error('[拖动] 移动失败:', err) }
      })
    } else {
      const img = document.createElement('img')
      img.className = 'lib-ico lib-ico-app'
      try { img.setAttribute('src', appIconUrl) } catch {}
      row.appendChild(img); row.appendChild(label)
      try { const ext = (e.name.split('.').pop() || '').toLowerCase(); if (ext) row.classList.add('file-ext-' + ext) } catch {}

      // 单击加载文档并保持选中
      row.addEventListener('click', async () => { saveSelection(e.path, false, row); try { await state.opts?.onOpenFile(e.path) } catch {} })
      // 双击加载，兼容旧习惯
      row.addEventListener('dblclick', async () => { await state.opts?.onOpenFile(e.path) })

      row.setAttribute('draggable','true')
      row.addEventListener('dragstart', (ev) => {
        try {
          console.log('[拖动] 开始拖动文件:', e.path)
          ev.dataTransfer?.setData('text/plain', e.path)
          if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move'
        } catch {}
      })

      parent.appendChild(row)
    }
  }
}

async function renderRoot(root: string) {
  if (!state.container) return
  state.container.innerHTML = ''
  const topRow = document.createElement('div')
  topRow.className = 'lib-node lib-dir expanded'
  ;(topRow as any).dataset.path = root
  const tg = makeTg(); const ico = makeFolderIcon(); const label = document.createElement('span'); label.className='lib-name'; label.textContent = nameOf(root) || root
  topRow.appendChild(tg); topRow.appendChild(ico); topRow.appendChild(label)
  const kids = document.createElement('div')
  kids.className = 'lib-children'
  state.container.appendChild(topRow)
  state.container.appendChild(kids)
  state.expanded.add(root)
  await buildDir(root, root, kids)

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
      if (!isInside(root, src) || !isInside(root, dst)) return alert('仅允许在库目录内移动')
      if (await exists(dst)) {
        const choice = await conflictModal('目标已存在', ['覆盖', '自动改名', '取消'], 1)
        if (choice === 2) return
        if (choice === 1) {
          const nm = nameOf(src)
          const stem = nm.replace(/(\.[^.]+)$/,''); const ext = nm.match(/(\.[^.]+)$/)?.[1] || ''
          let i=1, cand=''
          do { cand = `${stem} ${++i}${ext}` } while (await exists(join(root, cand)))
          await moveFileSafe(src, join(root, cand))
        } else {
          await moveFileSafe(src, dst)
        }
      } else {
        await moveFileSafe(src, dst)
      }
      try { (window as any).flymdScheduleSync?.() } catch {}
      await api.refresh()
      console.log('[拖动] 移动完成:', src, '→', dst)
    } catch (err) { console.error('[拖动] 移动失败:', err) }
  })

  topRow.addEventListener('click', async () => {
    const was = state.expanded.has(root)
    const now = !was
    state.expanded[now ? 'add' : 'delete'](root)
    kids.style.display = now ? '' : 'none'
    topRow.classList.toggle('expanded', now)
    if (now && kids.childElementCount === 0) await buildDir(root, root, kids)
  })
}

async function refresh() {
  const root = await state.opts!.getRoot()
  if (!root) { if (state.container) state.container.innerHTML = '<div class="lib-empty">尚未选择库目录</div>'; return }
  // 刷新前清理目录缓存，确保显示与实际文件状态一致
  try { hasDocCache.clear(); hasDocPending.clear() } catch {}
  await renderRoot(root)
}

async function init(container: HTMLElement, opts: FileTreeOptions) {
  state.container = container; state.opts = opts
  // 兜底：在整个文件树区域内允许 dragover，避免出现全局“禁止”光标
  try {
    container.addEventListener('dragover', (ev) => { ev.preventDefault() })
  } catch {}
  await refresh()
  if (!state.watching) {
    try {
      const root = await state.opts.getRoot(); if (root) {
        const u = await watchImmediate(root, { recursive: true } as any, async () => { await refresh() })
        state.unwatch = () => { try { (u as any).unwatch?.(); } catch {} }
        state.watching = true
      }
    } catch { /* ignore */ }
  }
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
      bd.textContent = '请选择处理方式'
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
  getSelectedDir: () => (state.selectedIsDir ? (state.selected || null) : (state.selected ? base(state.selected) : null)),
  newFileInSelected, newFolderInSelected,
  setSort: (mode) => { state.sortMode = mode },
}

export default fileTree
