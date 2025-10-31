// 内置扩展：WebDAV 同步（极简策略）
// - F5 手动同步；启动时同步；关闭前异步触发同步（不阻塞）
// - 仅按最后修改时间比较；新者覆盖旧者；不做合并

import { Store } from '@tauri-apps/plugin-store'
import { readDir, stat, readFile, writeFile, mkdir, exists, open as openFileHandle, BaseDirectory, remove } from '@tauri-apps/plugin-fs'
import { appLocalDataDir } from '@tauri-apps/api/path'
import { openPath } from '@tauri-apps/plugin-opener'

// 计算文件内容的 MD5 哈希
async function calculateFileHash(data: Uint8Array): Promise<string> {
  try {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    return hashHex
  } catch (e) {
    console.warn('计算哈希失败', e)
    return ''
  }
}

// 同步元数据类型
type SyncMetadata = {
  files: {
    [path: string]: {
      hash: string
      mtime: number
      syncTime: number
    }
  }
  lastSyncTime: number
}

// 获取同步元数据
async function getSyncMetadata(): Promise<SyncMetadata> {
  try {
    const localDataDir = await appLocalDataDir()
    const metaPath = localDataDir + (localDataDir.includes('\\') ? '\\' : '/') + 'flymd-sync-meta.json'
    if (!(await exists(metaPath as any))) {
      return { files: {}, lastSyncTime: 0 }
    }
    const data = await readFile(metaPath as any)
    const text = new TextDecoder().decode(data)
    return JSON.parse(text) as SyncMetadata
  } catch (e) {
    console.warn('读取同步元数据失败', e)
    return { files: {}, lastSyncTime: 0 }
  }
}

// 保存同步元数据
async function saveSyncMetadata(meta: SyncMetadata): Promise<void> {
  try {
    const localDataDir = await appLocalDataDir()
    const metaPath = localDataDir + (localDataDir.includes('\\') ? '\\' : '/') + 'flymd-sync-meta.json'
    const text = JSON.stringify(meta, null, 2)
    const data = new TextEncoder().encode(text)
    await writeFile(metaPath as any, data as any)
  } catch (e) {
    console.warn('保存同步元数据失败', e)
  }
}

async function syncLog(msg: string): Promise<void> {
  try {
    const enc = new TextEncoder().encode(new Date().toISOString() + ' ' + msg + '\n')
    const f = await openFileHandle('flymd-sync.log' as any, { write: true, append: true, create: true, baseDir: BaseDirectory.AppLocalData } as any)
    try { await (f as any).write(enc as any) } finally { try { await (f as any).close() } catch {} }
  } catch {}
}

async function openSyncLog(): Promise<void> {
  try {
    const localDataDir = await appLocalDataDir()
    const logPath = localDataDir + (localDataDir.includes('\\') ? '\\' : '/') + 'flymd-sync.log'
    await openPath(logPath)
  } catch (e) {
    console.warn('打开日志失败', e)
    alert('打开日志失败: ' + (e?.message || e))
  }
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
    timeoutMs: Number(raw?.timeoutMs) > 0 ? Number(raw?.timeoutMs) : 120000,
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

type FileEntry = { path: string; mtime: number; hash?: string; isDir?: boolean }

async function scanLocal(root: string): Promise<Map<string, FileEntry>> {
  const map = new Map<string, FileEntry>()
  async function walk(dir: string, rel: string) {
    let ents: any[] = []
    try { ents = await readDir(dir, { recursive: false } as any) as any[] } catch { ents = [] }
    for (const e of ents) {
      const name = String(e.name || '')
if (name.startsWith('.')) { await syncLog('[scan-skip-hidden] ' + (rel ? rel + '/' : '') + name); continue }
      if (!name) continue
      const full = dir + (dir.includes('\\') ? '\\' : '/') + name
      const relp = rel ? rel + '/' + name : name
      try {
        // 正确判断是否为目录
        let isDir = !!(e as any)?.isDirectory
        if ((e as any)?.isDirectory === undefined) {
          try { const st = await stat(full) as any; isDir = !!st?.isDirectory } catch { isDir = false }
        }

        if (isDir) {
          await syncLog('[scan-dir] ' + (rel ? rel + '/' : '') + name)
          await walk(full, relp)
        } else {
          const meta = await stat(full)
          const mt = toEpochMs((meta as any)?.modifiedAt || (meta as any)?.mtime || (meta as any)?.mtimeMs)
          const __relUnix = relp.replace(/\\\\/g, '/')
          if (!/\.(md|markdown|txt|png|jpg|jpeg|gif|svg|pdf)$/i.test(__relUnix)) { await syncLog('[scan-skip-ext] ' + __relUnix); continue }

          // 读取文件并计算哈希
          const fileData = await readFile(full as any)
          const hash = await calculateFileHash(fileData as Uint8Array)

          await syncLog('[scan-ok] ' + __relUnix + ' hash=' + hash.substring(0, 8))
          map.set(__relUnix, { path: __relUnix, mtime: mt, hash })
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

async function deleteRemoteFile(baseUrl: string, auth: { username: string; password: string }, remotePath: string): Promise<void> {
  const http = await getHttpClient(); if (!http) throw new Error('no http client')
  const url = joinUrl(baseUrl, remotePath)
  const authStr = btoa(`${auth.username}:${auth.password}`)
  const headers: Record<string,string> = { Authorization: `Basic ${authStr}` }
  const resp = await http.fetch(url, { method: 'DELETE', headers })
  const ok = resp?.ok === true || (typeof resp.status === 'number' && resp.status >= 200 && resp.status < 300)
  if (!ok) throw new Error('HTTP ' + (resp?.status || ''))
}

export async function syncNow(reason: SyncReason): Promise<{ uploaded: number; downloaded: number; skipped?: boolean } | null> {
  try {
    const cfg = await getWebdavSyncConfig()
    if (!cfg.enabled) return { uploaded: 0, downloaded: 0, skipped: true }
    const localRoot = await getLibraryRoot(); if (!localRoot) { try { const el = document.getElementById('status'); if (el) el.textContent = '未选择库目录，已跳过同步'; setTimeout(() => { try { if (el) el.textContent = '' } catch {} }, 1800) } catch {}; return { uploaded: 0, downloaded: 0, skipped: true } }
    try { const el = document.getElementById('status'); if (el) el.textContent = '正在同步… 准备中' } catch {}
    const auth = { username: cfg.username, password: cfg.password }; await syncLog('[prep] root=' + (await getLibraryRoot()) + ' remoteRoot=' + cfg.rootPath)
    try { await ensureRemoteDir(cfg.baseUrl, auth, (cfg.rootPath || '').replace(/\/+$/, '')) } catch {}

    // 发现差异
    const [localIdx, remoteIdx] = await Promise.all([
      scanLocal(localRoot),
      listRemoteRecursively(cfg.baseUrl, auth, cfg.rootPath)
    ])

    // 获取上次同步的元数据
    const lastMeta = await getSyncMetadata()

    const plan: { type: 'upload' | 'download' | 'delete' | 'conflict'; rel: string; reason?: string }[] = []
    const allKeys = new Set<string>([...localIdx.keys(), ...remoteIdx.keys(), ...Object.keys(lastMeta.files)])

    for (const k of allKeys) {
      const local = localIdx.get(k)
      const remote = remoteIdx.get(k)
      const last = lastMeta.files[k]

      // 情况1：本地有，远程无
      if (local && !remote) {
        if (last) {
          // 上次同步过，现在远程没有了 → 远程被删除，删除本地
          plan.push({ type: 'download', rel: k, reason: 'remote-deleted' })
          await syncLog('[detect] ' + k + ' 远程已删除，将删除本地文件')
        } else {
          // 上次没同步过 → 本地新增，上传
          plan.push({ type: 'upload', rel: k, reason: 'local-new' })
        }
      }
      // 情况2：本地无，远程有
      else if (!local && remote) {
        if (last) {
          // 上次同步过，现在本地没有了 → 本地被删除，删除远程
          plan.push({ type: 'delete', rel: k, reason: 'local-deleted' })
          await syncLog('[detect] ' + k + ' 本地已删除，将删除远程文件')
        } else {
          // 上次没同步过 → 远程新增，下载
          plan.push({ type: 'download', rel: k, reason: 'remote-new' })
        }
      }
      // 情况3：本地和远程都有
      else if (local && remote) {
        // 先下载远程文件计算哈希
        let remoteHash = ''
        try {
          const remoteData = await downloadFile(cfg.baseUrl, auth, cfg.rootPath.replace(/\/+$/,'') + '/' + encodePath(k))
          remoteHash = await calculateFileHash(remoteData)
        } catch (e) {
          await syncLog('[warn] ' + k + ' 无法下载远程文件计算哈希: ' + (e?.message || e))
        }

        const localHash = local.hash || ''
        const lastHash = last?.hash || ''

        // 哈希相同 → 无需同步
        if (localHash === remoteHash) {
          await syncLog('[skip] ' + k + ' 哈希相同，跳过')
          continue
        }

        // 检查是否冲突：本地和远程都相对于上次同步发生了变化
        const localChanged = localHash !== lastHash
        const remoteChanged = remoteHash !== lastHash

        if (localChanged && remoteChanged) {
          // 冲突！两边都修改了
          plan.push({ type: 'conflict', rel: k, reason: 'both-modified' })
          await syncLog('[conflict!] ' + k + ' 本地和远程都已修改')
        } else if (localChanged) {
          // 只有本地改了 → 上传
          plan.push({ type: 'upload', rel: k, reason: 'local-modified' })
        } else if (remoteChanged) {
          // 只有远程改了 → 下载
          plan.push({ type: 'download', rel: k, reason: 'remote-modified' })
        } else {
          // 都没改，但哈希不同（理论上不应该发生）
          // 按时间戳处理
          const lm = Number(local.mtime) + (cfg.clockSkewMs || 0)
          const rm = Number(remote.mtime) - (cfg.clockSkewMs || 0)
          if (lm > rm) plan.push({ type: 'upload', rel: k, reason: 'local-newer-time' })
          else if (rm > lm) plan.push({ type: 'download', rel: k, reason: 'remote-newer-time' })
        }
      }
    }

    await syncLog('[plan] total=' + plan.length + ' local=' + localIdx.size + ' remote=' + remoteIdx.size);
    // 记录详细计划
    for (const p of plan) {
      await syncLog('[plan-detail] ' + p.type + ' ' + p.rel)
    }
    // 设置 deadline：只针对上传/下载循环，不包括扫描时间
    const deadline = Date.now() + (reason === 'shutdown' ? Math.min(5000, cfg.timeoutMs) : cfg.timeoutMs)
    let __processed = 0; let __total = plan.length;
    let __fail = 0; let __lastErr = ""
    try { const el = document.getElementById('status'); if (el) el.textContent = '正在同步… 0/' + __total } catch {}
    let up = 0, down = 0, del = 0, conflicts = 0
    const newMeta: SyncMetadata = { files: {}, lastSyncTime: Date.now() }

    for (const act of plan) {
      if (Date.now() > deadline) {
        await syncLog('[timeout] 超时中断，剩余 ' + (plan.length - __processed) + ' 个任务未完成')
        break
      }
      try {
        if (act.type === 'conflict') {
          // 处理冲突：提示用户
          conflicts++
          await syncLog('[conflict] ' + act.rel + ' - 需要手动处理')
          try {
            const msg = `文件冲突：${act.rel}\n\n本地和远程都已修改。\n\n请选择：\n- 确定：保留本地版本（上传）\n- 取消：保留远程版本（下载）`
            if (confirm(msg)) {
              // 用户选择保留本地 → 上传
              await syncLog('[conflict-resolve] ' + act.rel + ' 用户选择保留本地版本')
              const full = localRoot + (localRoot.includes('\\') ? '\\' : '/') + act.rel.replace(/\//g, localRoot.includes('\\') ? '\\' : '/')
              const buf = await readFile(full as any)
              const hash = await calculateFileHash(buf as Uint8Array)
              const relPath = encodePath(act.rel)
              const relDir = relPath.split('/').slice(0, -1).join('/')
              const remoteDir = (cfg.rootPath || '').replace(/\/+$/, '') + (relDir ? '/' + relDir : '')
              await ensureRemoteDir(cfg.baseUrl, auth, remoteDir)
              await uploadFile(cfg.baseUrl, auth, cfg.rootPath.replace(/\/+$/,'') + '/' + encodePath(act.rel), buf as any)
              up++
              // 记录到元数据
              const meta = await stat(full)
              newMeta.files[act.rel] = { hash, mtime: toEpochMs((meta as any)?.modifiedAt || (meta as any)?.mtime || (meta as any)?.mtimeMs), syncTime: Date.now() }
            } else {
              // 用户选择保留远程 → 下载
              await syncLog('[conflict-resolve] ' + act.rel + ' 用户选择保留远程版本')
              const data = await downloadFile(cfg.baseUrl, auth, cfg.rootPath.replace(/\/+$/,'') + '/' + encodePath(act.rel))
              const hash = await calculateFileHash(data)
              const full = localRoot + (localRoot.includes('\\') ? '\\' : '/') + act.rel.replace(/\//g, localRoot.includes('\\') ? '\\' : '/')
              const dir = full.split(/\\|\//).slice(0, -1).join(localRoot.includes('\\') ? '\\' : '/')
              if (!(await exists(dir as any))) { try { await mkdir(dir as any, { recursive: true } as any) } catch {} }
              await writeFile(full as any, data as any)
              down++
              // 记录到元数据
              const meta = await stat(full)
              newMeta.files[act.rel] = { hash, mtime: toEpochMs((meta as any)?.modifiedAt || (meta as any)?.mtime || (meta as any)?.mtimeMs), syncTime: Date.now() }
            }
          } catch (e) {
            await syncLog('[conflict-error] ' + act.rel + ' 处理冲突失败: ' + (e?.message || e))
          }
        } else if (act.type === 'download') {
          if (act.reason === 'remote-deleted') {
            // 删除本地文件
            await syncLog('[delete-local] ' + act.rel)
            const full = localRoot + (localRoot.includes('\\') ? '\\' : '/') + act.rel.replace(/\//g, localRoot.includes('\\') ? '\\' : '/')
            try { await remove(full as any) } catch {}
            del++
            await syncLog('[ok] delete-local ' + act.rel)
            // 从元数据中移除
          } else {
            // 正常下载
            await syncLog('[download] ' + act.rel + ' (' + act.reason + ')')
            const data = await downloadFile(cfg.baseUrl, auth, cfg.rootPath.replace(/\/+$/,'') + '/' + encodePath(act.rel))
            const hash = await calculateFileHash(data)
            const full = localRoot + (localRoot.includes('\\') ? '\\' : '/') + act.rel.replace(/\//g, localRoot.includes('\\') ? '\\' : '/')
            const dir = full.split(/\\|\//).slice(0, -1).join(localRoot.includes('\\') ? '\\' : '/')
            if (!(await exists(dir as any))) { try { await mkdir(dir as any, { recursive: true } as any) } catch {} }
            await writeFile(full as any, data as any)
            down++
            await syncLog('[ok] download ' + act.rel)
            // 记录到元数据
            const meta = await stat(full)
            newMeta.files[act.rel] = { hash, mtime: toEpochMs((meta as any)?.modifiedAt || (meta as any)?.mtime || (meta as any)?.mtimeMs), syncTime: Date.now() }
          }
        } else if (act.type === 'upload') {
          await syncLog('[upload] ' + act.rel + ' (' + act.reason + ')')
          const full = localRoot + (localRoot.includes('\\') ? '\\' : '/') + act.rel.replace(/\//g, localRoot.includes('\\') ? '\\' : '/')
          const buf = await readFile(full as any)
          const hash = await calculateFileHash(buf as Uint8Array)
          const relPath = encodePath(act.rel)
          const relDir = relPath.split('/').slice(0, -1).join('/')
          const remoteDir = (cfg.rootPath || '').replace(/\/+$/, '') + (relDir ? '/' + relDir : '')
          await ensureRemoteDir(cfg.baseUrl, auth, remoteDir)
          await uploadFile(cfg.baseUrl, auth, cfg.rootPath.replace(/\/+$/,'') + '/' + encodePath(act.rel), buf as any)
          up++
          await syncLog('[ok] upload ' + act.rel)
          // 记录到元数据
          const meta = await stat(full)
          newMeta.files[act.rel] = { hash, mtime: toEpochMs((meta as any)?.modifiedAt || (meta as any)?.mtime || (meta as any)?.mtimeMs), syncTime: Date.now() }
        } else if (act.type === 'delete') {
          // 删除远程文件
          await syncLog('[delete-remote] ' + act.rel + ' (' + act.reason + ')')
          await deleteRemoteFile(cfg.baseUrl, auth, cfg.rootPath.replace(/\/+$/,'') + '/' + encodePath(act.rel))
          del++
          await syncLog('[ok] delete-remote ' + act.rel)
          // 从元数据中移除
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

    // 保存同步元数据
    await saveSyncMetadata(newMeta)

    try {
      let msg = `同步完成（`
      if (up > 0) msg += `↑${up} `
      if (down > 0) msg += `↓${down} `
      if (del > 0) msg += `✗${del} `
      if (conflicts > 0) msg += `⚠${conflicts} `
      msg += `）`
      const el = document.getElementById('status')
      if (el) {
        el.textContent = msg
        setTimeout(() => { try { if (el) el.textContent = '' } catch {} }, 1800)
      }
    } catch {}
    await syncLog('[done] up=' + up + ' down=' + down + ' del=' + del + ' conflicts=' + conflicts + ' total=' + __total);
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
  const overlayId = 'sync-overlay'
  let overlay = document.getElementById(overlayId) as HTMLDivElement | null
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = overlayId
    overlay.className = 'upl-overlay hidden'
    overlay.innerHTML = `
      <div class="upl-dialog" role="dialog" aria-modal="true" aria-labelledby="sync-title">
        <div class="upl-header">
          <div id="sync-title">WebDAV 同步设置</div>
          <button id="sync-close" class="about-close" title="关闭">×</button>
        </div>
        <div class="upl-desc">自动同步库文件到 WebDAV 服务器。首次上传需要计算哈希值，耗时较长。</div>
        <form class="upl-body" id="sync-form">
          <div class="upl-grid">
            <div class="upl-section-title">基础配置</div>
            <label for="sync-enabled">启用同步</label>
            <div class="upl-field">
              <label class="switch">
                <input id="sync-enabled" type="checkbox"/>
                <span class="trk"></span><span class="kn"></span>
              </label>
            </div>
            <label for="sync-onstartup">启动时同步</label>
            <div class="upl-field">
              <label class="switch">
                <input id="sync-onstartup" type="checkbox"/>
                <span class="trk"></span><span class="kn"></span>
              </label>
            </div>
            <label for="sync-onshutdown">关闭前同步</label>
            <div class="upl-field">
              <label class="switch">
                <input id="sync-onshutdown" type="checkbox"/>
                <span class="trk"></span><span class="kn"></span>
              </label>
            </div>
            <label for="sync-timeout">超时(毫秒)</label>
            <div class="upl-field">
              <input id="sync-timeout" type="number" min="1000" step="1000" placeholder="120000"/>
              <div class="upl-hint">建议 120000（2分钟），网络较慢时可适当增加</div>
            </div>

            <div class="upl-section-title">WebDAV 服务器</div>
            <label for="sync-baseurl">Base URL</label>
            <div class="upl-field">
              <input id="sync-baseurl" type="url" placeholder="https://dav.example.com/remote.php/dav/files/user"/>
              <div class="upl-hint">
                推荐：<a href="https://infini-cloud.net/en/" target="_blank" style="color:#0066cc;text-decoration:none">infini</a>（使用推介码 <strong>HBG6T</strong> 额外获得 20+5G 空间）<br>
                
              </div>
            </div>
            <label for="sync-root">Root Path</label>
            <div class="upl-field">
              <input id="sync-root" type="text" placeholder="/flymd"/>
              <div class="upl-hint">文件将同步到此路径下</div>
            </div>
            <label for="sync-user">用户名</label>
            <div class="upl-field"><input id="sync-user" type="text" placeholder="必填"/></div>
            <label for="sync-pass">密码</label>
            <div class="upl-field"><input id="sync-pass" type="password" placeholder="必填"/></div>
          </div>
          <div class="upl-actions">
            <button type="button" id="sync-openlog" class="btn-secondary">打开日志</button>
            <button type="button" id="sync-test" class="btn-secondary">立即同步(F5)</button>
            <button type="submit" id="sync-save" class="btn-primary">保存</button>
          </div>
        </form>
      </div>
    `
    document.body.appendChild(overlay)
  }

  const show = (v: boolean) => {
    if (!overlay) return
    if (v) overlay.classList.remove('hidden')
    else overlay.classList.add('hidden')
  }

  const form = overlay.querySelector('#sync-form') as HTMLFormElement
  const btnClose = overlay.querySelector('#sync-close') as HTMLButtonElement
  const btnSave = overlay.querySelector('#sync-save') as HTMLButtonElement
  const btnTest = overlay.querySelector('#sync-test') as HTMLButtonElement
  const btnOpenLog = overlay.querySelector('#sync-openlog') as HTMLButtonElement
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
  elTimeout.value = String(cfg.timeoutMs || 120000)
  elBase.value = cfg.baseUrl || ''
  elRoot.value = cfg.rootPath || '/flymd'
  elUser.value = cfg.username || ''
  elPass.value = cfg.password || ''

  const onSubmit = async (e: Event) => {
    e.preventDefault()
    try {
      await setWebdavSyncConfig({
        enabled: elEnabled.checked,
        onStartup: elOnStartup.checked,
        onShutdown: elOnShutdown.checked,
        timeoutMs: Math.max(1000, Number(elTimeout.value) || 120000),
        baseUrl: elBase.value.trim(),
        rootPath: elRoot.value.trim() || '/flymd',
        username: elUser.value,
        password: elPass.value,
      })
      // 反馈
      try { const el = document.getElementById('status'); if (el) { el.textContent = '已保存 WebDAV 同步配置'; setTimeout(() => { try { el.textContent = '' } catch {} }, 1200) } } catch {}
      show(false)
    } catch (e) {
      alert('保存失败: ' + (e?.message || e))
    }
  }

  const onCancel = () => show(false)
  const onOverlayClick = (e: MouseEvent) => { if (e.target === overlay) onCancel() }

  form.addEventListener('submit', onSubmit)
  btnTest.onclick = () => { void syncNow('manual') }
  btnOpenLog.onclick = () => { void openSyncLog() }
  btnClose.onclick = onCancel
  overlay.addEventListener('click', onOverlayClick)

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
