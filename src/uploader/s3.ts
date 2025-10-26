// 直连 S3/R2（SigV4）最小实现：
// - 支持 path-style 与自定义域名
// - 默认模板 {year}/{month}{fileName}{md5}.{extName}
// - 仅依赖 Web Crypto（SHA-256/HMAC-SHA256）+ 轻量 MD5 实现

export type UploaderConfig = {
  enabled: boolean
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  region?: string
  endpoint?: string
  customDomain?: string
  keyTemplate?: string
  aclPublicRead?: boolean
  forcePathStyle?: boolean
}

function isTauriRuntime(): boolean {
  try {
    // @ts-ignore
    return typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__)
  } catch { return false }
}

async function tryPluginHttp(): Promise<{ fetch?: any; Body?: any } | null> {
  try {
    const mod: any = await import('@tauri-apps/plugin-http')
    if (mod && typeof mod.fetch === 'function' && mod.Body) return { fetch: mod.fetch, Body: mod.Body }
    return null
  } catch { return null }
}

// RFC3986 编码（分段，保留 /）
function encodeRfc3986Path(path: string): string {
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()))
    .join('/')
}

function toHex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf)
  const hex: string[] = []
  for (let i = 0; i < b.length; i++) hex.push(b[i].toString(16).padStart(2, '0'))
  return hex.join('')
}

async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const enc = typeof data === 'string' ? new TextEncoder().encode(data).buffer : data
  const d = await crypto.subtle.digest('SHA-256', enc)
  return toHex(d)
}

async function hmacSha256Raw(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = key instanceof ArrayBuffer ? key : key.buffer
  const cryptoKey = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
  return sig
}

async function deriveSigningKey(secretAccessKey: string, date: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmacSha256Raw(new TextEncoder().encode('AWS4' + secretAccessKey), date)
  const kRegion = await hmacSha256Raw(kDate, region)
  const kService = await hmacSha256Raw(kRegion, service)
  const kSigning = await hmacSha256Raw(kService, 'aws4_request')
  return kSigning
}

// 极简 MD5（基于常见实现改写为 TS，无外部依赖）
function md5Hex(buf: ArrayBuffer): string {
  const x = new Uint8Array(buf)
  const len = x.length
  const words = new Uint32Array(((len + 8 >>> 6) + 1) << 4)
  for (let i = 0; i < len; i++) words[i >> 2] |= x[i] << ((i % 4) << 3)
  const bitLen = len * 8
  words[bitLen >> 5] |= 0x80 << (bitLen % 32)
  words[((bitLen + 64 >>> 9) << 4) + 14] = bitLen
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878
  const ff = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => ((a + ((b & c) | (~b & d)) + x + t) << s | (a + ((b & c) | (~b & d)) + x + t) >>> (32 - s)) + b | 0
  const gg = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => ((a + ((b & d) | (c & ~d)) + x + t) << s | (a + ((b & d) | (c & ~d)) + x + t) >>> (32 - s)) + b | 0
  const hh = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => ((a + (b ^ c ^ d) + x + t) << s | (a + (b ^ c ^ d) + x + t) >>> (32 - s)) + b | 0
  const ii = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => ((a + (c ^ (b | ~d)) + x + t) << s | (a + (c ^ (b | ~d)) + x + t) >>> (32 - s)) + b | 0
  for (let i = 0; i < words.length; i += 16) {
    const oa = a, ob = b, oc = c, od = d
    a = ff(a, b, c, d, words[i + 0], 7, -680876936)
    d = ff(d, a, b, c, words[i + 1], 12, -389564586)
    c = ff(c, d, a, b, words[i + 2], 17, 606105819)
    b = ff(b, c, d, a, words[i + 3], 22, -1044525330)
    a = ff(a, b, c, d, words[i + 4], 7, -176418897)
    d = ff(d, a, b, c, words[i + 5], 12, 1200080426)
    c = ff(c, d, a, b, words[i + 6], 17, -1473231341)
    b = ff(b, c, d, a, words[i + 7], 22, -45705983)
    a = ff(a, b, c, d, words[i + 8], 7, 1770035416)
    d = ff(d, a, b, c, words[i + 9], 12, -1958414417)
    c = ff(c, d, a, b, words[i + 10], 17, -42063)
    b = ff(b, c, d, a, words[i + 11], 22, -1990404162)
    a = ff(a, b, c, d, words[i + 12], 7, 1804603682)
    d = ff(d, a, b, c, words[i + 13], 12, -40341101)
    c = ff(c, d, a, b, words[i + 14], 17, -1502002290)
    b = ff(b, c, d, a, words[i + 15], 22, 1236535329)
    a = gg(a, b, c, d, words[i + 1], 5, -165796510)
    d = gg(d, a, b, c, words[i + 6], 9, -1069501632)
    c = gg(c, d, a, b, words[i + 11], 14, 643717713)
    b = gg(b, c, d, a, words[i + 0], 20, -373897302)
    a = gg(a, b, c, d, words[i + 5], 5, -701558691)
    d = gg(d, a, b, c, words[i + 10], 9, 38016083)
    c = gg(c, d, a, b, words[i + 15], 14, -660478335)
    b = gg(b, c, d, a, words[i + 4], 20, -405537848)
    a = gg(a, b, c, d, words[i + 9], 5, 568446438)
    d = gg(d, a, b, c, words[i + 14], 9, -1019803690)
    c = gg(c, d, a, b, words[i + 3], 14, -187363961)
    b = gg(b, c, d, a, words[i + 8], 20, 1163531501)
    a = gg(a, b, c, d, words[i + 13], 5, -1444681467)
    d = gg(d, a, b, c, words[i + 2], 9, -51403784)
    c = gg(c, d, a, b, words[i + 7], 14, 1735328473)
    b = gg(b, c, d, a, words[i + 12], 20, -1926607734)
    a = hh(a, b, c, d, words[i + 5], 4, -378558)
    d = hh(d, a, b, c, words[i + 8], 11, -2022574463)
    c = hh(c, d, a, b, words[i + 11], 16, 1839030562)
    b = hh(b, c, d, a, words[i + 14], 23, -35309556)
    a = hh(a, b, c, d, words[i + 1], 4, -1530992060)
    d = hh(d, a, b, c, words[i + 4], 11, 1272893353)
    c = hh(c, d, a, b, words[i + 7], 16, -155497632)
    b = hh(b, c, d, a, words[i + 10], 23, -1094730640)
    a = hh(a, b, c, d, words[i + 13], 4, 681279174)
    d = hh(d, a, b, c, words[i + 0], 11, -358537222)
    c = hh(c, d, a, b, words[i + 3], 16, -722521979)
    b = hh(b, c, d, a, words[i + 6], 23, 76029189)
    a = ii(a, b, c, d, words[i + 0], 6, -198630844)
    d = ii(d, a, b, c, words[i + 7], 10, 1126891415)
    c = ii(c, d, a, b, words[i + 14], 15, -1416354905)
    b = ii(b, c, d, a, words[i + 5], 21, -57434055)
    a = ii(a, b, c, d, words[i + 12], 6, 1700485571)
    d = ii(d, a, b, c, words[i + 3], 10, -1894986606)
    c = ii(c, d, a, b, words[i + 10], 15, -1051523)
    b = ii(b, c, d, a, words[i + 1], 21, -2054922799)
    a = ii(a, b, c, d, words[i + 8], 6, 1873313359)
    d = ii(d, a, b, c, words[i + 15], 10, -30611744)
    c = ii(c, d, a, b, words[i + 6], 15, -1560198380)
    b = ii(b, c, d, a, words[i + 13], 21, 1309151649)
    a = (a + oa) | 0
    b = (b + ob) | 0
    c = (c + oc) | 0
    d = (d + od) | 0
  }
  const r = new DataView(new ArrayBuffer(16))
  r.setUint32(0, a, true)
  r.setUint32(4, b, true)
  r.setUint32(8, c, true)
  r.setUint32(12, d, true)
  return toHex(r.buffer)
}

function guessExtFromTypeOrName(contentType: string, name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/)
  if (m) return m[1]
  if (/jpeg/.test(contentType)) return 'jpg'
  if (/png/.test(contentType)) return 'png'
  if (/gif/.test(contentType)) return 'gif'
  if (/webp/.test(contentType)) return 'webp'
  if (/bmp/.test(contentType)) return 'bmp'
  if (/avif/.test(contentType)) return 'avif'
  if (/svg/.test(contentType)) return 'svg'
  return 'png'
}

function baseNameNoExt(name: string): string {
  const n = name.split(/[\\/]+/).pop() || name
  return n.replace(/\.[^.]+$/, '')
}

function pad2(n: number): string { return n < 10 ? '0' + n : '' + n }

function formatAmzDate(): { amzDate: string; dateStamp: string } {
  const d = new Date()
  const yyyy = d.getUTCFullYear()
  const mm = pad2(d.getUTCMonth() + 1)
  const dd = pad2(d.getUTCDate())
  const hh = pad2(d.getUTCHours())
  const mi = pad2(d.getUTCMinutes())
  const ss = pad2(d.getUTCSeconds())
  const dateStamp = `${yyyy}${mm}${dd}`
  const amzDate = `${dateStamp}T${hh}${mi}${ss}Z`
  return { amzDate, dateStamp }
}

async function makeKeyFromTemplate(template: string, fileName: string, contentType: string, bytes: ArrayBuffer): Promise<string> {
  const now = new Date()
  const year = String(now.getFullYear())
  const month = pad2(now.getMonth() + 1)
  const day = pad2(now.getDate())
  const hour = pad2(now.getHours())
  const minute = pad2(now.getMinutes())
  const second = pad2(now.getSeconds())
  const extName = guessExtFromTypeOrName(contentType, fileName)
  const fileBase = baseNameNoExt(fileName)
  let key = template || '{year}/{month}{fileName}{md5}.{extName}'
  let md5 = ''
  try { md5 = md5Hex(bytes) } catch { md5 = '' }
  key = key
    .replace(/\{year\}/g, year)
    .replace(/\{month\}/g, month)
    .replace(/\{day\}/g, day)
    .replace(/\{hour\}/g, hour)
    .replace(/\{minute\}/g, minute)
    .replace(/\{second\}/g, second)
    .replace(/\{fileName\}/g, fileBase)
    .replace(/\{extName\}/g, extName)
    .replace(/\{md5\}/g, md5)
  return key.replace(/^\/+/, '')
}

function ensureEndpointUrl(endpoint?: string): URL {
  const ep = (endpoint || '').trim()
  if (!ep) return new URL('https://s3.amazonaws.com')
  try {
    if (/^https?:\/\//i.test(ep)) return new URL(ep)
    return new URL('https://' + ep)
  } catch {
    return new URL('https://s3.amazonaws.com')
  }
}

function guessRegionForR2(endpointHost: string, region?: string): string {
  if (region && region.trim()) return region.trim()
  if (/\.r2\.cloudflarestorage\.com/i.test(endpointHost)) return 'auto'
  return 'us-east-1'
}

function buildUploadUrl(endpointUrl: URL, bucket: string, key: string, forcePathStyle: boolean): { url: URL; hostForSig: string; canonicalUri: string } {
  const origin = endpointUrl.origin
  const basePath = endpointUrl.pathname.replace(/\/+$/, '')
  const encKey = encodeRfc3986Path(key)
  if (forcePathStyle) {
    const full = `${origin}${basePath}/${encodeURIComponent(bucket)}/${encKey}`
    const url = new URL(full)
    const hostForSig = url.host
    const canonicalUri = `${basePath}/${encodeURIComponent(bucket)}/${encKey}` || '/'
    return { url, hostForSig, canonicalUri }
  } else {
    // 虚拟主机风格：bucket 作为子域。注意 endpoint 必须无路径
    const host = `${bucket}.${endpointUrl.host}`
    const full = `${endpointUrl.protocol}//${host}/${encKey}`
    const url = new URL(full)
    const hostForSig = url.host
    const canonicalUri = `/${encKey}`
    return { url, hostForSig, canonicalUri }
  }
}

function buildPublicUrl(customDomain: string | undefined, endpointUrl: URL, bucket: string, key: string, forcePathStyle: boolean): string {
  const encKey = key.split('/').map(encodeURIComponent).join('/')
  if (customDomain && customDomain.trim()) {
    const base = customDomain.replace(/\/+$/, '')
    return `${base}/${encKey}`
  }
  if (forcePathStyle) {
    const basePath = endpointUrl.pathname.replace(/\/+$/, '')
    return `${endpointUrl.origin}${basePath}/${encodeURIComponent(bucket)}/${encKey}`
  } else {
    return `${endpointUrl.protocol}//${bucket}.${endpointUrl.host}/${encKey}`
  }
}

export async function uploadImageToS3R2(input: Blob | ArrayBuffer | Uint8Array, fileName: string, contentType: string, cfg: UploaderConfig): Promise<{ key: string; publicUrl: string }> {
  if (!cfg || !cfg.enabled) throw new Error('uploader disabled')
  if (!cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucket) throw new Error('uploader config incomplete')
  const endpointUrl = ensureEndpointUrl(cfg.endpoint)
  const region = guessRegionForR2(endpointUrl.host, cfg.region)
  const forcePathStyle = cfg.forcePathStyle !== false // 默认 true
  const aclPublicRead = cfg.aclPublicRead !== false  // 默认 true

  let bytes: ArrayBuffer
  if (input instanceof Blob) bytes = await input.arrayBuffer()
  else if (input instanceof Uint8Array) bytes = input.buffer
  else bytes = input

  const key = await makeKeyFromTemplate(cfg.keyTemplate || '{year}/{month}{fileName}{md5}.{extName}', fileName, contentType, bytes)
  const { url, hostForSig, canonicalUri } = buildUploadUrl(endpointUrl, cfg.bucket, key, forcePathStyle)

  const { amzDate, dateStamp } = formatAmzDate()
  const service = 's3'
  // 为了最大兼容 S3/R2 直传与各类代理，使用 UNSIGNED-PAYLOAD（HTTPS 下安全）
  const payloadHash = 'UNSIGNED-PAYLOAD'

  // headers（小写、排序）
  const headers: Record<string, string> = {
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    'content-type': contentType || 'application/octet-stream',
  }
  if (aclPublicRead) headers['x-amz-acl'] = 'public-read'

  const sendHeaderNames = Object.keys(headers).map((h) => h.toLowerCase())
  // host 必须包含在签名中（即使不显式设置，也会由 HTTP 栈注入）
  const signedHeaderNames = Array.from(new Set([...sendHeaderNames, 'host'])).sort()
  const signedHeaders = signedHeaderNames.join(';')
  const canonicalHeaders = signedHeaderNames.map((h) => {
    if (h === 'host') return `host:${hostForSig}`
    return `${h}:${headers[h].toString().trim()}`
  }).join('\n') + '\n'
  const canonicalRequest = ['PUT', canonicalUri || '/', '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`
  const signingKey = await deriveSigningKey(cfg.secretAccessKey, dateStamp, region, service)
  const signature = toHex(await hmacSha256Raw(signingKey, stringToSign))
  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  // 优先尝试 Tauri plugin-http（可绕过 CORS）；如不可用再回退到浏览器 fetch。
  // Tauri 环境下，若插件不可用，直接抛错让上层回退为本地，不再走浏览器 fetch（避免 CORS）
  if (isTauriRuntime()) {
    const client = await tryPluginHttp()
    if (client && client.fetch && client.Body) {
      const h: Record<string, string> = {}
      for (const k of Object.keys(headers)) h[k] = headers[k]
      h['authorization'] = authorization
      const body = new Uint8Array(bytes)
      const resp = await client.fetch(url.toString(), { method: 'PUT', headers: h, body: client.Body.bytes(body) })
      const ok = resp && (resp.ok === true || (typeof resp.status === 'number' && resp.status >= 200 && resp.status < 300))
      if (!ok) {
        const status = resp?.status ?? 0
        const statusText = resp?.statusText ?? ''
        throw new Error(`upload failed via plugin-http: ${status} ${statusText}`)
      }
      const publicUrl = buildPublicUrl(cfg.customDomain, endpointUrl, cfg.bucket, key, forcePathStyle)
      return { key, publicUrl }
    } else {
      throw new Error('tauri plugin-http not available')
    }
  }

  const putHeaders: HeadersInit = new Headers()
  for (const k of Object.keys(headers)) putHeaders.set(k, headers[k])
  putHeaders.set('authorization', authorization)

  const res = await fetch(url.toString(), { method: 'PUT', headers: putHeaders, body: bytes })
  if (!res.ok) {
    const text = await (async () => { try { return await res.text() } catch { return '' } })()
    throw new Error(`upload failed: ${res.status} ${res.statusText} ${text}`)
  }

  const publicUrl = buildPublicUrl(cfg.customDomain, endpointUrl, cfg.bucket, key, forcePathStyle)
  return { key, publicUrl }
}
