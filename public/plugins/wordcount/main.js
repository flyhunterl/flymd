// 字数统计插件（示例）
export function activate(context) {
  // 在菜单栏添加一个按钮
  context.addMenuItem({
    label: '字数',
    title: '统计当前文档字符数',
    onClick: () => {
      try {
        const content = context.getEditorValue()
        const n = (content || '').length >>> 0
        context.ui.notice('当前字符数：' + n, 'ok', 2000)
      } catch (e) {
        context.ui.notice('统计失败', 'err', 2000)
      }
    }
  })
}

export function deactivate() { /* 无需清理 */ }
