// 代码块装饰：语言角标、行号与复制按钮
export function decorateCodeBlocks(preview: HTMLElement) {
  try {
    const codes = Array.from(preview.querySelectorAll('pre > code.hljs')) as HTMLElement[]
    for (const code of codes) {
      const pre = code.parentElement as HTMLElement | null
      if (!pre || pre.getAttribute('data-codebox') === '1') continue
      if (code.classList.contains('language-mermaid')) continue
      const lang = ((Array.from(code.classList).find(c => c.startsWith('language-')) || '').slice(9) || 'text').toUpperCase()
      // 包装行生成行号（不破坏高亮 span）
      try {
        const html = code.innerHTML
        const parts = html.split('\n')
        code.innerHTML = parts.map(p => `<span class="cb-ln">${p || '&nbsp;'}</span>`).join('\n')
      } catch {}
      const box = document.createElement('div')
      box.className = 'codebox'
      const badge = document.createElement('div')
      badge.className = 'code-lang'
      badge.textContent = lang
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'code-copy'
      btn.textContent = '复制'
      if (pre.parentElement) pre.parentElement.insertBefore(box, pre)
      box.appendChild(pre)
      box.appendChild(badge)
      box.appendChild(btn)
      pre.setAttribute('data-codebox', '1')
    }
  } catch {}
}
