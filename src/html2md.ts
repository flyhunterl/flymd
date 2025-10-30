/*
  简易 HTML → Markdown 转换器（零依赖）
  - 覆盖常见块级：p/div/section、h1~h6、pre>code、blockquote、ul/ol/li、table、hr
  - 覆盖常见行内：strong/b、em/i、s/del/strike、a、img、code、br
  - 适度处理 span 的加粗/斜体/删除线 style
  - 尽量生成「可读、稳定」的 Markdown，而不是逐字符等价


*/

type Opts = {
  baseUrl?: string
}

const blockTags = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'HR'
])

function isBlock(el: Element): boolean {
  return blockTags.has(el.tagName)
}

function repeat(ch: string, n: number): string { return new Array(Math.max(0, n) + 1).join(ch) }

function escapeMd(text: string): string {
  // 在非 code 上下文逃逸常见 Markdown 特殊字符（保持可读性而不过度转义）
  return text
    .replace(/\\/g, '\\\\')
    .replace(/([*_`#|>\-])/g, '\\$1')
}

function collapseWhitespace(s: string): string {
  // 压缩多余空白，但保留换行
  return s.replace(/\u00A0/g, ' ').replace(/[ \t\f\v]+/g, ' ')
}

function getAttr(el: Element, name: string): string | null {
  const v = el.getAttribute(name)
  return v != null ? v : null
}

function getCodeLang(el: Element): string | null {
  const cls = (getAttr(el, 'class') || '').toLowerCase()
  // 支持 language-xxx / lang-xxx
  const m = cls.match(/(?:language|lang)-([\w#+.-]+)/)
  return m ? m[1] : null
}

function styleHas(el: Element, prop: string, includes: RegExp): boolean {
  const st = (getAttr(el, 'style') || '').toLowerCase()
  const map = Object.create(null) as Record<string, string>
  st.split(';').forEach(pair => {
    const [k, v] = pair.split(':').map(x => x?.trim())
    if (k) map[k] = v || ''
  })
  const v = map[prop]
  return v ? includes.test(v) : false
}

function isBoldLike(el: Element): boolean {
  return el.tagName === 'B' || el.tagName === 'STRONG' || styleHas(el, 'font-weight', /(bold|[6-9]00)/)
}

function isItalicLike(el: Element): boolean {
  return el.tagName === 'I' || el.tagName === 'EM' || styleHas(el, 'font-style', /(italic|oblique)/)
}

function isStrikeLike(el: Element): boolean {
  return el.tagName === 'S' || el.tagName === 'DEL' || el.tagName === 'STRIKE' || styleHas(el, 'text-decoration', /line-through/)
}

function trimBlankLines(s: string): string {
  return s.replace(/^\s+\n/, '\n').replace(/\n\s+$/, '\n').replace(/^\n+|\n+$/g, '')
}

function normalizeLines(s: string): string {
  // 保证块与块之间最多 2 个换行
  return s.replace(/\n{3,}/g, '\n\n')
}

function textContentOf(node: Node): string {
  return (node as any).textContent || ''
}

function renderInlineChildren(el: Element, ctx: Ctx): string {
  let out = ''
  for (const child of Array.from(el.childNodes)) {
    out += renderNode(child, ctx)
  }
  return out
}

function codeFence(text: string, lang?: string | null): string {
  // 选择合适数量的反引号，避免与内容冲突
  let fence = '```'
  if (text.includes('```')) fence = '````'
  const info = lang ? lang : ''
  return `${fence}${info ? ' ' + info : ''}\n${text.replace(/\n$/, '')}\n${fence}`
}

type Ctx = {
  listDepth: number
  orderedStack: boolean[]
  orderedIndex: number[]
  baseUrl?: string
}

function renderList(el: Element, ctx: Ctx, ordered: boolean): string {
  const items = Array.from(el.children).filter(ch => ch.tagName === 'LI') as Element[]
  const next: Ctx = {
    ...ctx,
    listDepth: ctx.listDepth + 1,
    orderedStack: ctx.orderedStack.concat([ordered]),
    orderedIndex: ctx.orderedIndex.concat([0])
  }
  let out: string[] = []
  for (const li of items) {
    const idx = next.orderedIndex[next.orderedIndex.length - 1] + 1
    next.orderedIndex[next.orderedIndex.length - 1] = idx
    const bullet = ordered ? `${idx}. ` : '- '
    // li 内部：首段在同一行，其余段落缩进对齐
    const contentMd = trimBlankLines(renderListItem(li, next))
    const lines = contentMd.split('\n')
    const indent = repeat('  ', ctx.listDepth)
    const first = `${indent}${bullet}${lines[0] || ''}`
    const rest = lines.slice(1).map(l => `${indent}  ${l}`)
    out.push([first].concat(rest).join('\n'))
  }
  return out.join('\n')
}

function renderListItem(li: Element, ctx: Ctx): string {
  // 将 li 的子节点作为块内容渲染，但避免在首行前后额外空行
  const parts: string[] = []
  for (const child of Array.from(li.childNodes)) {
    const md = renderNode(child, ctx)
    if (!md) continue
    parts.push(md)
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n')
}

function renderTable(table: Element, ctx: Ctx): string {
  // 仅支持简单表格（无换行、多行头复杂布局）
  const rows: Element[] = []
  const thead = table.querySelector('thead')
  const tbody = table.querySelector('tbody')
  const tfoot = table.querySelector('tfoot')
  const collectRows = (scope: Element | null) => {
    if (!scope) return
    for (const tr of Array.from(scope.querySelectorAll(':scope > tr'))) rows.push(tr)
  }
  if (thead) collectRows(thead)
  if (tbody) collectRows(tbody)
  if (tfoot) collectRows(tfoot)
  if (!thead && !tbody && !tfoot) collectRows(table)

  const grid: string[][] = []
  let headerCells: string[] | null = null
  for (const tr of rows) {
    const cells = Array.from(tr.children).filter(c => c.tagName === 'TD' || c.tagName === 'TH') as Element[]
    const texts = cells.map(td => {
      // 单元格内只取「内联」渲染，避免生成额外换行
      const md = trimBlankLines(renderInlineChildren(td, ctx))
      return collapseWhitespace(md).replace(/\n+/g, ' ').trim()
    })
    if (!headerCells && cells.some(c => c.tagName === 'TH')) headerCells = texts
    grid.push(texts)
  }
  const head = headerCells || grid[0] || []
  const body = headerCells ? grid : grid.slice(1)
  if (head.length === 0) return ''
  const sep = head.map(() => '---')
  const lines: string[] = []
  const rowLine = (cols: string[]) => `| ${cols.join(' | ')} |`
  lines.push(rowLine(head))
  lines.push(rowLine(sep))
  for (const row of body) lines.push(rowLine(row))
  return lines.join('\n')
}

function absolutizeUrl(href: string, base?: string): string {
  try {
    if (!base) return href
    const u = new URL(href, base)
    return u.href
  } catch { return href }
}

function renderNode(node: Node, ctx: Ctx): string {
  if (!node) return ''
  if (node.nodeType === Node.TEXT_NODE) {
    const t = (node.nodeValue || '').replace(/\s+/g, (m) => (m.includes('\n') ? '\n' : ' '))
    return escapeMd(t)
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as Element
  const tag = el.tagName

  // 忽略脚本类标签
  if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'META' || tag === 'LINK') return ''

  if (tag === 'BR') return '  \n'
  if (tag === 'HR') return '\n\n---\n\n'

  if (tag === 'IMG') {
    const alt = getAttr(el, 'alt') || ''
    const src = getAttr(el, 'src') || ''
    const title = getAttr(el, 'title')
    const url = absolutizeUrl(src, ctx.baseUrl)
    return `![${escapeMd(alt)}](${url}${title ? ' "' + escapeMd(title) + '"' : ''})`
  }

  if (tag === 'A') {
    const href = getAttr(el, 'href') || ''
    const title = getAttr(el, 'title')
    const text = trimBlankLines(renderInlineChildren(el, ctx)) || (getAttr(el, 'href') || '')
    const url = absolutizeUrl(href, ctx.baseUrl)
    return `[${text}](${url}${title ? ' "' + escapeMd(title) + '"' : ''})`
  }

  if (tag === 'CODE') {
    // 父元素 PRE 的处理由 PRE 分支完成
    const raw = textContentOf(el)
    // 选择围栏长度避免冲突
    const ticks = raw.includes('`') ? '``' : '`'
    return `${ticks}${raw}${ticks}`
  }

  if (tag === 'PRE') {
    const code = el.querySelector('code')
    let text = code ? textContentOf(code) : textContentOf(el)
    // 归一化行尾
    text = text.replace(/\r\n?/g, '\n')
    const lang = code ? getCodeLang(code) : null
    return `\n\n${codeFence(text, lang)}\n\n`
  }

  if (/^H[1-6]$/.test(tag)) {
    const level = Number(tag.substring(1)) || 1
    const hashes = repeat('#', Math.max(1, Math.min(6, level)))
    const content = trimBlankLines(renderInlineChildren(el, ctx))
    return `\n\n${hashes} ${content}\n\n`
  }

  if (tag === 'BLOCKQUOTE') {
    const inner = trimBlankLines(renderInlineChildren(el, ctx))
    const prefixed = inner.split('\n').map(l => `> ${l}`).join('\n')
    return `\n\n${prefixed}\n\n`
  }

  if (tag === 'UL') return `\n${renderList(el, ctx, false)}\n\n`
  if (tag === 'OL') return `\n${renderList(el, ctx, true)}\n\n`

  if (tag === 'TABLE') {
    return `\n\n${renderTable(el, ctx)}\n\n`
  }

  // 样式驱动的强调（span 等）
  if (isBoldLike(el) || isItalicLike(el) || isStrikeLike(el)) {
    const content = renderInlineChildren(el, ctx)
    let out = content
    if (isBoldLike(el)) out = `**${out}**`
    if (isItalicLike(el)) out = `*${out}*`
    if (isStrikeLike(el)) out = `~~${out}~~`
    return out
  }

  // 常规块：拼接子节点，并在块边界添加空行
  if (isBlock(el)) {
    const inner = trimBlankLines(renderInlineChildren(el, ctx))
    if (!inner) return ''
    return `\n\n${inner}\n\n`
  }

  // 其它一律按内联拼接
  return renderInlineChildren(el, ctx)
}

export function htmlToMarkdown(html: string, opts: Opts = {}): string {
  if (!html || !html.trim()) return ''
  // DOM 解析
  const parser = new DOMParser()
  // 有些来源的剪贴板只给片段，统一包裹
  const doc = parser.parseFromString(`<!doctype html><meta charset="utf-8"><div id="__root__">${html}</div>`, 'text/html')
  const root = doc.getElementById('__root__') as HTMLElement | null
  if (!root) return ''

  const ctx: Ctx = { listDepth: 0, orderedStack: [], orderedIndex: [], baseUrl: opts.baseUrl }
  let out = ''
  for (const child of Array.from(root.childNodes)) {
    out += renderNode(child, ctx)
  }
  out = normalizeLines(trimBlankLines(out))
  // 收尾清理：去除两端多余空行
  return out.trim() + '\n'
}

export default htmlToMarkdown
