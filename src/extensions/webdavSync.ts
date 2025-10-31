// 内置扩展：WebDAV 同步（极简策略）
// - F5 手动同步；启动时同步；关闭前异步触发同步（不阻塞）
// - 仅按最后修改时间比较；新者覆盖旧者；不做合并

import { Store } from '@tauri-apps/plugin-store'
import { readDir, stat, readFile, writeFile, mkdir, exists, open as openFileHandle, BaseDirectory } from '@tauri-apps/plugin-fs'

async function syncLog(msg: string): Promise<void> {
  try {
    const enc = new TextEncoder().encode(new Date().toISOString() + ' ' + msg + '\n')
    const f = await openFileHandle('flymd-sync.log' as any, { write: true, append: true, create: true, baseDir: BaseDirectory.AppLocalData } as any)
    try { await (f as any).write(enc as any) } finally { try { await (f as any).close() } catch {} }
  } catch {}
}

import { getCurrentWindow } from '@tauri-apps/api/window'

export type SyncReason = 'manual' | 'startup' | 'shutdown'

export type WebdavSyncConfig = {
  enabled: boolean
  onStartup: boolean
  onShutdown: boolean
  timeoutMs: number
  includeGlobs: string[]
  excludeGlobs: string[]
  baseUrl: string
  username: string
  password: string
  rootPath: string
  clockSkewMs?: number
}

let _store: Store | null = null
async function getStore(): Promise<Store> {
  if (_store) return _store
  _store = await Store.load('flymd-settings.json')
  return _store
}

export async function getWebdavSyncConfig(): Promise<WebdavSyncConfig> {
  const store = await getStore()
  const raw = (await store.get('sync')) as any
  const cfg: WebdavSyncConfig = {
    enabled: raw?.enabled !== false,
    onStartup: raw?.onStartup !== false,
    onShutdown: raw?.onShutdown !== false,
    timeoutMs: Number(raw?.timeoutMs) > 0 ? Number(raw?.timeoutMs) : 20000,
    includeGlobs: Array.isArray(raw?.includeGlobs) ? raw.includeGlobs : ['**/*.md', '**/*.{png,jpg,jpeg,gif,svg,pdf}'],
    excludeGlobs: Array.isArray(raw?.excludeGlobs) ? raw.excludeGlobs : ['**/.git/**','**/.trash/**','**/.DS_Store','**/Thumbs.db'],
    baseUrl: String(raw?.baseUrl || ''),
    username: String(raw?.username || ''),
    password: String(raw?.password || ''),
    rootPath: String(raw?.rootPath || '/flymd'),
    clockSkewMs: Number(raw?.clockSkewMs) || 0,
  }
  return cfg
}

export async function setWebdavSyncConfig(next: Partial<WebdavSyncConfig>): Promise<void> {
  const store = await getStore()
  const cur = (await store.get('sync')) as any || {}
  const merged = { ...cur, ...next }
  await store.set('sync', merged)
  await store.save()
}

async function getLibraryRoot(): Promise<string | null> {
  try { const s = await getStore(); const val = await s.get('libraryRoot'); if (typeof val === 'string' && val) return val; return null } catch { return null }
}

// 轻量 HTTP 客户端（优先使用 tauri plugin-http，回退到 fetch）
async function getHttpClient(): Promise<{ fetch: any; ResponseType?: any; Body?: any } | null> {
  try { const mod: any = await import('@tauri-apps/plugin-http'); if (typeof mod?.fetch === 'function') return { fetch: mod.fetch, ResponseType: mod.ResponseType, Body: mod.Body } } catch {}
  try { return { fetch: (input: string, init: any) => fetch(input, init) } as any } catch { return null }
}

function joinUrl(...parts: string[]): string {
  const segs: string[] = []
  for (const p of parts) {
    if (!p) continue
    let s = p.replace(/\\/g, '/').trim()
    if (s === '/') { segs.push(''); continue }
    s = s.replace(/^\/+/, '').replace(/\/+$/, '')
    if (s) segs.push(s)
  }
  let u = segs.join('/')
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u // 容错：用户误填
  return u
}

function encodePath(path: string): string {
  // 对每段进行 encodeURI，保留斜杠
  return path.split('/').map(encodeURIComponent).join('/')
}

function toEpochMs(v: any): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const t = Date.parse(v); if (Number.isFinite(t)) return t }
  try { if (v instanceof Date) return v.getTime() } catch {}
  const n = Number(v); return Number.isFinite(n) ? n : 0
}

type FileEntry = { path: string; mtime: number; isDir?: boolean }

async function scanLocal(root: string): Promise<Map<string, FileEntry>> {
  const map = new Map<string, FileEntry>()
  async function walk(dir: string, rel: string) {
    let ents: any[] = []
    try { ents = await readDir(dir, { recursive: false } as any) as any[] } catch { ents = [] }
    for (const e of ents) {
      const name = String(e.name || '')
if (name.startsWith('.')) { continue }
      if (!name) continue
      const full = dir + (dir.includes('\\') ? '\\' : '/') + name
      const relp = rel ? rel + '/' + name : name
      try {
        if (e.isDir) {
          await walk(full, relp)
        } else {
          const meta = await stat(full)
          const mt = toEpochMs((meta as any)?.modifiedAt || (meta as any)?.mtime || (meta as any)?.mtimeMs)
          const __relUnix = relp.replace(/\\\\/g, '/')
          if (!/\.(md|markdown|txt|png|jpg|jpeg|gif|svg|pdf)$/i.test(__relUnix)) { continue }
          map.set(__relUnix, { path: __relUnix, mtime: mt })
        }
      } catch {}
    }
  }
  await walk(root, '')
  return map
}

async function listRemoteDir(baseUrl: string, auth: { username: string; password: string }, remotePath: string): Promise<{ files: { name: string; isDir: boolean; mtime?: number }[] }> {
  const http = await getHttpClient(); if (!http) throw new Error('no http client')
  const url = joinUrl(baseUrl, remotePath)
  const body = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/><d:resourcetype/></d:prop></d:propfind>`
  const headers: Record<string,string> = { Depth: '1', 'Content-Type': 'application/xml' }
  const authStr = btoa(`${auth.username}:${auth.password}`)
  headers['Authorization'] = `Basic ${authStr}`
  let text = ''
  try {
    const resp = await http.fetch(url, { method: 'PROPFIND', headers, body })
    // plugin-http: ok true; browser: resp.ok
    if (resp?.ok === true || (typeof resp.status === 'number' && resp.status >= 200 && resp.status < 300)) {
      text = typeof resp.text === 'function' ? await resp.text() : (resp.data || '')
    } else {
      throw new Error('HTTP ' + (resp?.status || ''))
    }
  } catch (e) {
    // 回退：部分服务可能需要 application/xml + charset
    const resp = await http.fetch(url, { method: 'PROPFIND', headers: { ...headers, 'Content-Type': 'text/xml; charset=utf-8' }, body })
    if (resp?.ok === true || (typeof resp.status === 'number' && resp.status >= 200 && resp.status < 300)) {
      text = typeof resp.text === 'function' ? await resp.text() : (resp.data || '')
    } else { throw e }
  }
  const files: { name: string; isDir: boolean; mtime?: number }[] = []
  try {
    const doc = new DOMParser().parseFromString(String(text || ''), 'application/xml')
    const respNodes = Array.from(doc.getElementsByTagNameNS('*','response'))
    for (const r of respNodes) {
      const hrefEl = (r as any).getElementsByTagNameNS?.('*','href')?.[0] as Element | undefined
      const mEl = (r as any).getElementsByTagNameNS?.('*','getlastmodified')?.[0] as Element | undefined
      const typeEl = (r as any).getElementsByTagNameNS?.('*','resourcetype')?.[0] as Element | undefined
      let href = hrefEl?.textContent || ''
      if (!href) continue
      try { href = decodeURIComponent(href) } catch {}
      // 跳过自身目录项
      const baseHref = joinUrl(baseUrl, remotePath) + (joinUrl(baseUrl, remotePath).endsWith('/') ? '' : '/')
      if (href.replace(/\\/g,'/').replace(/\/+$/,'/') === baseHref.replace(/\\/g,'/').replace(/\/+$/,'/')) continue
      // 取最后一段作为 name
      const segs = href.replace(/\/+$/,'').split('/')
      const name = segs.pop() || ''
      const isDir = /<d:collection\b/i.test(typeEl?.outerHTML || '')
      const mt = mEl?.textContent ? toEpochMs(mEl.textContent) : undefined
      files.push({ name, isDir, mtime: mt })
    }
  } catch {}
  return { files }
}

async function listRemoteRecursively(baseUrl: string, auth: { username: string; password: string }, rootPath: string): Promise<Map<string, FileEntry>> {
  const map = new Map<string, FileEntry>()
  async function walk(rel: string) {
    const full = rel ? rootPath.replace(/\/+$/,'') + '/' + rel.replace(/^\/+/, '') : rootPath
let __filesRes: any = { files: [] }; try { __filesRes = await listRemoteDir(baseUrl, auth, full) } catch { __filesRes = { files: [] } }
const files = __filesRes.files || []
    for (const f of files) {
      const r = rel ? rel + '/' + f.name : f.name
      if (f.isDir) {
        await walk(r)
      } else {
        map.set(r, { path: r, mtime: toEpochMs(f.mtime) })
      }
    }
  }
  await walk('')
  return map
}

async function downloadFile(baseUrl: string, auth: { username: string; password: string }, remotePath: string): Promise<Uint8Array> {
  const http = await getHttpClient(); if (!http) throw new Error('no http client')
  const url = joinUrl(baseUrl, remotePath)
  const authStr = btoa(`${auth.username}:${auth.password}`)
  const headers: Record<string,string> = { Authorization: `Basic ${authStr}` }
  const resp = await http.fetch(url, { method: 'GET', headers, responseType: (http as any).ResponseType?.Binary })
  const ok = resp?.ok === true || (typeof resp.status === 'number' && resp.status >= 200 && resp.status < 300)
  if (!ok) throw new Error('HTTP ' + (resp?.status || ''))
  const buf: any = (typeof resp.arrayBuffer === 'function') ? await resp.arrayBuffer() : resp.data
  const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : (buf as Uint8Array)
  return u8
}

async function uploadFile(baseUrl: string, auth: { username: string; password: string }, remotePath: string, data: Uint8Array): Promise<void> {
  const http = await getHttpClient(); if (!http) throw new Error('no http client')
  const url = joinUrl(baseUrl, remotePath)
  const authStr = btoa(`${auth.username}:${auth.password}`)
  const headers: Record<string,string> = { Authorization: `Basic ${authStr}`, 'Content-Type': 'application/octet-stream' }
  const body = (http as any).Body?.bytes ? (http as any).Body.bytes(data) : data
  const resp = await http.fetch(url, { method: 'PUT', headers, body })
  const ok = resp?.ok === true || (typeof resp.status === 'number' && resp.status >= 200 && resp.status < 300)
  if (!ok) throw new Error('HTTP ' + (resp?.status || ''))
}

export async function syncNow(reason: SyncReason): Promise<{ uploaded: number; downloaded: number; skipped?: boolean } | null> {
  try {
    const cfg = await getWebdavSyncConfig()
    if (!cfg.enabled) return { uploaded: 0, downloaded: 0, skipped: true }
    const localRoot = await getLibraryRoot(); if (!localRoot) { try { const el = document.getElementById('status'); if (el) el.textContent = '未选择库目录，已跳过同步'; setTimeout(() => { try { if (el) el.textContent = '' } catch {} }, 1800) } catch {}; return { uploaded: 0, downloaded: 0, skipped: true } }
    try { const el = document.getElementById('status'); if (el) el.textContent = '正在同步… 准备中' } catch {}
    const deadline = Date.now() + (reason === 'shutdown' ? Math.min(5000, cfg.timeoutMs) : cfg.timeoutMs)
    const auth = { username: cfg.username, password: cfg.password }; await syncLog('[prep] root=' + (await getLibraryRoot()) + ' remoteRoot=' + cfg.rootPath)
    try { await ensureRemoteDir(cfg.baseUrl, auth, (cfg.rootPath || '').replace(/\/+$/, '')) } catch {}

    // 发现差异
    const [localIdx, remoteIdx] = await Promise.all([
      scanLocal(localRoot),
      listRemoteRecursively(cfg.baseUrl, auth, cfg.rootPath)
    ])

    const plan: { type: 'upload' | 'download'; rel: string }[] = []
    const allKeys = new Set<string>([...localIdx.keys(), ...remoteIdx.keys()])
    for (const k of allKeys) {
      const l = localIdx.get(k)
      const r = remoteIdx.get(k)
      if (l && !r) plan.push({ type: 'upload', rel: k })
      else if (!l && r) plan.push({ type: 'download', rel: k })
      else if (l && r) {
        const lm = Number(l.mtime) + (cfg.clockSkewMs || 0)
        const rm = Number(r.mtime) - (cfg.clockSkewMs || 0)
        if (lm > rm) plan.push({ type: 'upload', rel: k })
        else if (rm > lm) plan.push({ type: 'download', rel: k })
      }
    }
    await syncLog('[plan] total=' + plan.length + ' local=' + localIdx.size + ' remote=' + remoteIdx.size);
    let __processed = 0; let __total = plan.length;
    let __fail = 0; let __lastErr = ""
    try { const el = document.getElementById('status'); if (el) el.textContent = '正在同步… 0/' + __total } catch {}
    let up = 0, down = 0
    for (const act of plan) {
      if (Date.now() > deadline) break
      try {
        if (act.type === 'download') {
          await syncLog('[download] ' + act.rel)
          const data = await downloadFile(cfg.baseUrl, auth, cfg.rootPath.replace(/\/+$/,'') + '/' + encodePath(act.rel))
          const full = localRoot + (localRoot.includes('\\') ? '\\' : '/') + act.rel.replace(/\//g, localRoot.includes('\\') ? '\\' : '/')
          const dir = full.split(/\\|\//).slice(0, -1).join(localRoot.includes('\\') ? '\\' : '/')
          if (!(await exists(dir as any))) { try { await mkdir(dir as any, { recursive: true } as any) } catch {} }
          await writeFile(full as any, data as any)
          down++
          await syncLog('[ok] download ' + act.rel)
        } else if (act.type === 'upload') {
          // 过滤：隐藏项/目录/非白名单扩展，避免 os error 5
          if (act.rel.split('/').some(seg => seg.startsWith('.'))) { continue }
          const __extOk = /\.(md|markdown|txt|png|jpg|jpeg|gif|svg|pdf)$/i.test(act.rel)
          if (!__extOk) { continue }
          const full = localRoot + (localRoot.includes('\\') ? '\\' : '/') + act.rel.replace(/\//g, localRoot.includes('\\') ? '\\' : '/')
          const __meta = await stat(full as any).catch(() => null) as any
          if (!__meta || __meta.isDir === true || __meta.isDirectory === true) { continue }
          await syncLog('[upload] ' + act.rel)
          const buf = await readFile(full as any)
          const relPath = encodePath(act.rel)
          const relDir = relPath.split('/').slice(0, -1).join('/')
          const remoteDir = (cfg.rootPath || '').replace(/\/+$/, '') + (relDir ? '/' + relDir : '')
          await ensureRemoteDir(cfg.baseUrl, auth, remoteDir)
          await uploadFile(cfg.baseUrl, auth, cfg.rootPath.replace(/\/+$/,'') + '/' + encodePath(act.rel), buf as any)
          up++
          await syncLog('[ok] upload ' + act.rel)
        }
      } catch (e) {
        console.warn('sync step failed', act, e)
        try { await syncLog('[fail] ' + act.type + ' ' + act.rel + ' : ' + (e?.message || e)) } catch {}
        __fail++
        try { __lastErr = String(e?.message || e || __lastErr) } catch {}
        try { const el = document.getElementById('status'); if (el) el.textContent = '正在同步… ' + __processed + '/' + __total + '（失败 ' + __fail + '）' } catch {}
      }
      __processed++
      try { const el = document.getElementById('status'); if (el) el.textContent = '正在同步… ' + __processed + '/' + __total } catch {}
    }
    try { const el = document.getElementById('status'); if (el) el.textContent = `同步完成（↑${up} / ↓${down}）`; setTimeout(() => { try { if (el) el.textContent = '' } catch {} }, 1800) } catch {}
    await syncLog('[done] up=' + up + ' down=' + down + ' total=' + __total);
    return { uploaded: up, downloaded: down }
  } catch (e) { try { await syncLog('[error] ' + (e?.message || e)) } catch {}
    console.warn('sync failed', e)
    try { const el = document.getElementById('status'); if (el) el.textContent = '同步失败：' + (e?.message || '未知错误'); setTimeout(() => { try { if (el) el.textContent = '' } catch {} }, 3000) } catch {}
    return null
  }
}

export async function initWebdavSync(): Promise<void> {
  try {
    const cfg = await getWebdavSyncConfig()
    // F5 快捷键
    try {
      document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'F5') { e.preventDefault(); void syncNow('manual') }
      })
    } catch {}
    // 启动后触发一次
    if (cfg.enabled && cfg.onStartup) { setTimeout(() => { void syncNow('startup') }, 600) }
    // 关闭前触发（异步，不阻塞关闭）
    try { void getCurrentWindow().onCloseRequested(async () => { try { const c = await getWebdavSyncConfig(); if (c.enabled && c.onShutdown) { void syncNow('shutdown') } } catch {} }) } catch {}
  } catch {}
}

export async function openWebdavSyncDialog(): Promise<void> {
  // 简单设置面板（覆盖写入 store 中的 sync 配置）
  const overlayId = 'sync-overlay'
  let overlay = document.getElementById(overlayId) as HTMLDivElement | null
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = overlayId
    overlay.style.position = 'fixed'; overlay.style.left = '0'; overlay.style.top = '0'; overlay.style.right = '0'; overlay.style.bottom = '0'
    overlay.style.background = 'rgba(0,0,0,0.35)'; overlay.style.zIndex = '9999'; overlay.style.display = 'none'
    const panel = document.createElement('div')
    panel.style.width = '560px'; panel.style.maxWidth = '90vw'; panel.style.margin = '10vh auto'; panel.style.background = '#fff'; panel.style.borderRadius = '8px'; panel.style.padding = '16px'; panel.style.boxShadow = '0 6px 24px rgba(0,0,0,0.2)'
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-size:16px;font-weight:600">WebDAV 同步设置</div>
        <button id="sync-close" title="关闭" style="font-size:18px;line-height:18px;border:none;background:transparent;cursor:pointer">×</button>
      </div>
      <div style="display:grid;grid-template-columns:120px 1fr;gap:8px 12px;align-items:center;">
        <label>启用同步</label><input id="sync-enabled" type="checkbox"/>
        <label>启动时同步</label><input id="sync-onstartup" type="checkbox"/>
        <label>关闭前同步</label><input id="sync-onshutdown" type="checkbox"/>
        <label>超时(毫秒)</label><input id="sync-timeout" type="number" min="1000" step="1000" placeholder="20000"/>
        <label>Base URL</label><input id="sync-baseurl" type="text" placeholder="https://dav.example.com/remote.php/dav/files/user"/>
        <label>Root Path</label><input id="sync-root" type="text" placeholder="/flymd"/>
        <label>用户名</label><input id="sync-user" type="text"/>
        <label>密码</label><input id="sync-pass" type="password"/>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">
        <button id="sync-test" class="btn">立即同步(F5)</button>
        <button id="sync-save" class="btn primary">保存</button>
      </div>
    `
    overlay.appendChild(panel)
    document.body.appendChild(overlay)
  }
  const show = (v: boolean) => { overlay!.style.display = v ? 'block' : 'none' }
  const btnClose = overlay.querySelector('#sync-close') as HTMLButtonElement
  const btnSave = overlay.querySelector('#sync-save') as HTMLButtonElement
  const btnTest = overlay.querySelector('#sync-test') as HTMLButtonElement
  const elEnabled = overlay.querySelector('#sync-enabled') as HTMLInputElement
  const elOnStartup = overlay.querySelector('#sync-onstartup') as HTMLInputElement
  const elOnShutdown = overlay.querySelector('#sync-onshutdown') as HTMLInputElement
  const elTimeout = overlay.querySelector('#sync-timeout') as HTMLInputElement
  const elBase = overlay.querySelector('#sync-baseurl') as HTMLInputElement
  const elRoot = overlay.querySelector('#sync-root') as HTMLInputElement
  const elUser = overlay.querySelector('#sync-user') as HTMLInputElement
  const elPass = overlay.querySelector('#sync-pass') as HTMLInputElement

  const cfg = await getWebdavSyncConfig()
  elEnabled.checked = !!cfg.enabled
  elOnStartup.checked = !!cfg.onStartup
  elOnShutdown.checked = !!cfg.onShutdown
  elTimeout.value = String(cfg.timeoutMs || 20000)
  elBase.value = cfg.baseUrl || ''
  elRoot.value = cfg.rootPath || '/flymd'
  elUser.value = cfg.username || ''
  elPass.value = cfg.password || ''

  btnSave.onclick = async () => {
    try {
      await setWebdavSyncConfig({
        enabled: elEnabled.checked,
        onStartup: elOnStartup.checked,
        onShutdown: elOnShutdown.checked,
        timeoutMs: Math.max(1000, Number(elTimeout.value) || 20000),
        baseUrl: elBase.value.trim(),
        rootPath: elRoot.value.trim() || '/flymd',
        username: elUser.value,
        password: elPass.value,
      })
      // 反馈
      try { const el = document.getElementById('status'); if (el) { el.textContent = '已保存 WebDAV 同步配置'; setTimeout(() => { try { el.textContent = '' } catch {} }, 1200) } } catch {}
      show(false)
    } catch (e) { alert('保存失败: ' + e) }
  }
  btnTest.onclick = () => { void syncNow('manual') }
  btnClose.onclick = () => show(false)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) show(false) })
  show(true)
}
// 远端目录保障：逐级 MKCOL 创建目录（已存在则忽略）
async function mkcol(baseUrl: string, auth: { username: string; password: string }, remotePath: string): Promise<number> {
  const http = await getHttpClient(); if (!http) return 0
  const url = joinUrl(baseUrl, remotePath)
  const authStr = btoa(`${auth.username}:${auth.password}`)
  const headers: Record<string,string> = { Authorization: `Basic ${authStr}`}
  try { const resp = await (http as any).fetch(url, { method: 'MKCOL', headers }); return Number((resp as any)?.status || 0) } catch { return 0 }
}

async function ensureRemoteDir(baseUrl: string, auth: { username: string; password: string }, remoteDir: string): Promise<void> {
  try {
    if (!remoteDir) return
    const parts = remoteDir.replace(/\\/g,'/').replace(/\/+$/,'').split('/').filter(Boolean)
    let cur = ''
    for (const p of parts) { cur += '/' + p; try { await mkcol(baseUrl, auth, cur) } catch {} }
  } catch {}
}
