// 代码块装饰：加角标、行号与复制按钮
export function decorateCodeBlocks(preview: HTMLElement) {
  try {
    const codes = Array.from(preview.querySelectorAll('pre > code.hljs')) as HTMLElement[]
    for (const code of codes) {
      const pre = code.parentElement as HTMLElement | null
      if (!pre || pre.getAttribute('data-codebox') === '1') continue
      if (code.classList.contains('language-mermaid')) continue
      const lang = ((Array.from(code.classList).find(c => c.startsWith('language-')) || '').slice(9) || 'text').toUpperCase()
      // 按行包裹，并移除末尾多余空行（通常由渲染器结尾的 \n 导致）
      try {
        const html = code.innerHTML
        const parts = html.split('\n')
        if (parts.length && parts[parts.length - 1] === '') parts.pop()
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

