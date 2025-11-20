// 轻量级多语言支持（无外部依赖）
// - 仅覆盖“用户可见 UI 文案”（菜单、按钮、页签、对话框、空态、关于）
// - 默认跟随系统语言；可通过菜单切换：自动/中文/English

export type LocalePref = 'auto' | 'zh' | 'en'
export type Locale = 'zh' | 'en'

const LS_KEY = 'flymd.locale'

function detectSystemLocale(): Locale {
  try {
    const lang = (navigator.language || navigator['userLanguage'] || 'en').toLowerCase()
    if (lang.startsWith('zh')) return 'zh'
  } catch {}
  return 'en'
}

export function getLocalePref(): LocalePref {
  try {
    const v = localStorage.getItem(LS_KEY) as LocalePref | null
    if (v === 'zh' || v === 'en' || v === 'auto') return v
  } catch {}
  return 'auto'
}

export function setLocalePref(v: LocalePref) {
  try { localStorage.setItem(LS_KEY, v) } catch {}
}

export function getLocale(): Locale {
  const pref = getLocalePref()
  if (pref === 'zh' || pref === 'en') return pref
  return detectSystemLocale()
}

// UI 字典
const dict = {
  zh: {
    'menu.file': '文件',
    'menu.mode': '模式',
    'menu.recent': '最近',
    'menu.uploader': '图床',
    'menu.extensions': '扩展',
    'menu.update': '更新',
    'menu.about': '关于',
    'menu.language': '语言',

    'file.new': '新建',
    'file.open': '打开…',
    'file.save': '保存',
    'file.saveas': '另存为…',

    'mode.edit': '编辑',
    'mode.read': '阅读',
    'mode.wysiwyg': '所见',

    'tab.files': '目录',
    'tab.outline': '大纲',
    'tab.files.short': '目录',
    'tab.outline.short': '大纲',

    'lib.menu': '库',
    'lib.choose': '库管理',
    'lib.refresh': '刷新',
    'lib.choose.short': '库管理',
    'lib.refresh.short': '刷新',
    'lib.pin.auto': '自动',
    'lib.pin.fixed': '固定',

    'about.title': '关于',
    'about.tagline': '一款跨平台、轻量稳定好用的 Markdown 编辑 PDF 阅读工具。',
    'about.close': '关闭',
    'about.license.brief': '开源协议：非商业开源（NC 1.0）。商业使用需授权。',
    'about.license.link': '查看完整许可文本',
    'about.official': '官方网站',
    'about.blog': '个人网站：',
    'about.github': 'GitHub：',

    'dlg.ok': '确定',
    'dlg.cancel': '取消',
    'dlg.insert': '插入',
    'dlg.rename': '重命名',
    'dlg.link': '插入链接',
    'dlg.text': '文本',
    'dlg.url': 'URL',
    'dlg.test': '测试连接',
    'dlg.link.text.ph': '链接文本',
    'dlg.url.ph': 'https://',
    'dlg.name': '名称',
    'dlg.name.ph': '请输入新名称',
    'dlg.ext': '后缀',

    'status.pos': '行 {line}, 列 {col}',
    'filename.untitled': '未命名',
    'editor.placeholder': '在此输入 Markdown 文本……',

    // 图床设置（S3/R2）
    'upl.title': '图床设置（S3 / R2）',
    'upl.desc': '用于将粘贴/拖拽的图片自动上传到对象存储，保存后即生效（仅在启用时）。',
    'upl.section.basic': '基础配置',
    'upl.enable': '启用',
    'upl.alwaysLocal': '总是保存到本地',
    'upl.hint.alwaysLocal': '开启后，无论图床是否启用，粘贴/拖拽/链接插入的图片都会复制到当前文档同目录的 images 文件夹，并立即生效',
    'upl.ak': 'AccessKeyId',
    'upl.ak.ph': '必填',
    'upl.sk': 'SecretAccessKey',
    'upl.sk.ph': '必填',
    'upl.bucket': 'Bucket',
    'upl.bucket.ph': '必填',
    'upl.endpoint': '自定义节点地址',
    'upl.endpoint.ph': '例如 https://xxx.r2.cloudflarestorage.com',
    'upl.endpoint.hint': 'R2: https://<accountid>.r2.cloudflarestorage.com；S3: https://s3.<region>.amazonaws.com',
    'upl.region': 'Region（可选）',
    'upl.region.ph': 'R2 用 auto；S3 如 ap-southeast-1',
    'upl.section.access': '访问域名与路径',
    'upl.domain': '自定义域名',
    'upl.domain.ph': '例如 https://img.example.com',
    'upl.domain.hint': '填写后将使用该域名生成公开地址',
    'upl.template': '上传路径模板',
    'upl.template.ph': '{year}/{month}{fileName}{md5}.{extName}',
    'upl.template.hint': '可用变量：{year}{month}{day}{fileName}{md5}{extName}',
    'upl.section.advanced': '高级选项',
    'upl.pathstyle': 'Path-Style（R2 建议）',
    'upl.acl': 'public-read',
    // WebP 转换
    'upl.webp.enable': '转WebP[Gif直接跳过]',
    'upl.webp.quality': 'WebP 质量',
    'upl.webp.quality.hint': '范围 0.6–0.95，默认 0.85；数值越大质量越高但体积更大',
    'upl.webp.local': '本地保存也转为 WebP',

    // WebDAV 同步
    'sync.title': 'WebDAV 同步设置',
    'sync.desc': '自动同步库文件到 WebDAV 服务器。首次上传需要计算哈希值，耗时较长。',
    'sync.warn.global': '⚠️ 同步功能上线不久，仍在测试。请务必备份数据。',
    'sync.section.basic': '基础配置',
    'sync.enable': '启用同步',
    'sync.onstartup': '启动时同步',
    'sync.onshutdown': '关闭前同步',
    'sync.warn.onshutdown': '⚠️ 启用后，关闭窗口会隐藏到后台继续同步，同步完成后自动退出',
    'sync.timeout.label': '超时(毫秒)',
    'sync.timeout.suggest': '建议 120000（2分钟），网络较慢时可适当增加',
    'sync.conflict': '冲突策略',
    'sync.conflict.newest': '自动选择较新文件（推荐）',
    'sync.conflict.ask': '每次询问用户',
    'sync.conflict.remote': '总是保留远程版本',
    'sync.smartSkip': '智能跳过远程扫描（分钟）',
    'sync.smartSkip.hint': '若本地无修改且距上次同步未超过此时间，将跳过远程扫描（设为0则每次都扫描）',
    'sync.server': 'WebDAV 服务器',
    'sync.root.hint': '文件将同步到此路径下',
    'sync.user': '用户名',
    'sync.pass': '密码',
    'sync.openlog': '打开日志',
    'sync.now': '立即同步(F5)',
    'sync.save': '保存',
    'sync.saved': '已保存 WebDAV 同步配置',
    'sync.save.fail': '保存失败: {msg}',

    // 文件树冲突弹窗
    'ft.move.within': '仅允许在库目录内移动',
    'ft.exists': '目标已存在',
    'ft.conflict.prompt': '请选择处理方式',
    'action.overwrite': '覆盖',
    'action.renameAuto': '自动改名',
    'action.cancel': '取消',

    // 语言菜单
    'lang.auto': '自动',
    'lang.zh': '中文',
    'lang.en': 'English',

    // 右键菜单
    'ctx.newFile': '在此新建文档',
    'ctx.newFolder': '在此新建文件夹',
    'ctx.customIcon': '自定义图标',
    'ctx.moveTo': '移动到…',
    'ctx.rename': '重命名',
    'ctx.delete': '删除',
    'ctx.sortNameAsc': '按名称 A→Z',
    'ctx.sortNameDesc': '按名称 Z→A',
    'ctx.sortTimeDesc': '按修改时间 新→旧',
    'ctx.sortTimeAsc': '按修改时间 旧→新',

    // 扩展与插件
    'ext.title': '扩展与插件管理',
    'ext.install.section': '安装扩展（GitHub 或 URL）',
    'ext.install.placeholder': '输入 URL 或 username/repository@branch（branch 可省略）',
    'ext.install.btn': '安装',
    'ext.builtin': '内置扩展',
    'ext.installed': '已安装扩展',
    'ext.available': '扩展市场',
    'ext.market.channel': '渠道',
    'ext.market.channel.github': 'GitHub',
    'ext.market.channel.official': '官网',
    'ext.refresh': '刷新',
    'ext.update.btn': '更新',
    'ext.update.ok': '扩展已更新',
    'ext.update.fail': '更新扩展失败',
    'ext.update.notice.single': '{name} 扩展有新版本',
    'ext.update.notice.multi': '{count} 个扩展有新版本: {names}',
    'ext.settings': '设置',
    'ext.settings.notProvided': '该扩展未提供设置',
    'ext.settings.openFail': '打开扩展设置失败',
    'ext.toggle.enable': '启用',
    'ext.toggle.disable': '禁用',
    'ext.toggle.fail': '切换扩展失败',
    'ext.remove': '移除',
    'ext.remove.confirm': '确定移除扩展 {name} ？',
    'ext.removed': '已移除扩展',
    'ext.remove.fail': '移除扩展失败',
    'ext.install.ok': '安装成功',
    'ext.install.fail': '安装扩展失败',
    'ext.enabled.tag.on': '✓ 已启用',
    'ext.enabled.tag.off': '未启用',
    'ext.author': '作者:',
    'ext.homepage': '主页',
    'ext.market.loading': '扩展市场正在加载…',
  },
    en: {
    'menu.file': 'File',
    'menu.mode': 'Mode',
    'menu.recent': 'Recent',
    'menu.uploader': 'Image Bed',
    'menu.extensions': 'Extensions',
    'menu.update': 'Update',
    'menu.about': 'About',
    'menu.language': 'Language',

    'file.new': 'New',
    'file.open': 'Open…',
    'file.save': 'Save',
    'file.saveas': 'Save As…',

    'mode.edit': 'Edit',
    'mode.read': 'Preview',
    'mode.wysiwyg': 'WYSIWYG',

    'tab.files': 'Tree',
    'tab.outline': 'Outline',
    'tab.files.short': 'Tree',
    'tab.outline.short': 'Outl',

    'lib.menu': 'Library',
    'lib.choose': 'Manage',
    'lib.refresh': 'Refresh',
    'lib.choose.short': 'Manage',
    'lib.refresh.short': 'Ref',
    'lib.pin.auto': 'Auto',
    'lib.pin.fixed': 'Dock',

    'about.title': 'About',
    'about.tagline': 'A cross‑platform, lightweight and polished Markdown editor & PDF reader.',
    'about.close': 'Close',
    'about.license.brief': 'License: Non‑Commercial Open (NC 1.0). Commercial use requires authorization.',
    'about.license.link': 'View full license',
    'about.official': 'Official Site',
    'about.blog': 'Website: ',
    'about.github': 'GitHub: ',

    'dlg.ok': 'OK',
    'dlg.cancel': 'Cancel',
    'dlg.insert': 'Insert',
    'dlg.rename': 'Rename',
    'dlg.link': 'Insert Link',
    'dlg.text': 'Text',
    'dlg.url': 'URL',
    'dlg.test': 'Test Connection',
    'dlg.link.text.ph': 'Link text',
    'dlg.url.ph': 'https://',
    'dlg.name': 'Name',
    'dlg.name.ph': 'Enter new name',
    'dlg.ext': 'Extension',

    'status.pos': 'Ln {line}, Col {col}',
    'filename.untitled': 'Untitled',
    'editor.placeholder': 'Type Markdown here…',

    // Uploader (S3/R2)
    'upl.title': 'Image Bed Settings (S3 / R2)',
    'upl.desc': 'Paste/drag images to auto-upload to Object Storage. Takes effect after saving (only when enabled).',
    'upl.section.basic': 'Basic',
    'upl.enable': 'Enable',
    'upl.alwaysLocal': 'Always save locally',
    'upl.hint.alwaysLocal': 'When enabled, pasted/dragged/linked images are copied into the current document\'s images folder and applied immediately.',
    'upl.ak': 'AccessKeyId',
    'upl.ak.ph': 'Required',
    'upl.sk': 'SecretAccessKey',
    'upl.sk.ph': 'Required',
    'upl.bucket': 'Bucket',
    'upl.bucket.ph': 'Required',
    'upl.endpoint': 'Custom Endpoint',
    'upl.endpoint.ph': 'e.g. https://xxx.r2.cloudflarestorage.com',
    'upl.endpoint.hint': 'R2: https://<accountid>.r2.cloudflarestorage.com; S3: https://s3.<region>.amazonaws.com',
    'upl.region': 'Region (optional)',
    'upl.region.ph': 'R2: auto; S3: e.g. ap-southeast-1',
    'upl.section.access': 'Public Domain & Path',
    'upl.domain': 'Custom Domain',
    'upl.domain.ph': 'e.g. https://img.example.com',
    'upl.domain.hint': 'If set, the public URL will use this domain.',
    'upl.template': 'Upload Path Template',
    'upl.template.ph': '{year}/{month}{fileName}{md5}.{extName}',
    'upl.template.hint': 'Available vars: {year}{month}{day}{fileName}{md5}{extName}',
    'upl.section.advanced': 'Advanced',
    'upl.pathstyle': 'Path-Style (recommended for R2)',
    'upl.acl': 'public-read',
    // WebP conversion
    'upl.webp.enable': 'Convert to WebP before upload',
    'upl.webp.quality': 'WebP Quality',
    'upl.webp.quality.hint': 'Range 0.6–0.95, default 0.85; higher = better quality but larger size',
    'upl.webp.local': 'Also convert local saves to WebP',

    // WebDAV Sync
    'sync.title': 'WebDAV Sync Settings',
    'sync.desc': 'Automatically sync library files to a WebDAV server. The first upload computes hashes and may take time.',
    'sync.warn.global': '⚠️ The sync feature is new and under testing. Please back up your data.',
    'sync.section.basic': 'Basic',
    'sync.enable': 'Enable Sync',
    'sync.onstartup': 'Sync on Startup',
    'sync.onshutdown': 'Sync on Exit',
    'sync.warn.onshutdown': '⚠️ When enabled, the window hides and continues syncing; the app exits after completion.',
    'sync.timeout.label': 'Timeout (ms)',
    'sync.timeout.suggest': 'Recommended 120000 (2 minutes); increase for slow networks.',
    'sync.conflict': 'Conflict Strategy',
    'sync.conflict.newest': 'Pick newer automatically (recommended)',
    'sync.conflict.ask': 'Ask every time',
    'sync.conflict.remote': 'Always keep remote',
    'sync.smartSkip': 'Smart skip remote scan (minutes)',
    'sync.smartSkip.hint': 'If no local changes and within this window, skip remote scan (0 means always scan).',
    'sync.server': 'WebDAV Server',
    'sync.root.hint': 'Files will sync under this path',
    'sync.user': 'Username',
    'sync.pass': 'Password',
    'sync.openlog': 'Open Log',
    'sync.now': 'Sync Now (F5)',
    'sync.save': 'Save',
    'sync.saved': 'WebDAV sync settings saved',
    'sync.save.fail': 'Save failed: {msg}',

    'ft.move.within': 'Only moves within the library are allowed',
    'ft.exists': 'Target already exists',
    'ft.conflict.prompt': 'Choose an action',
    'action.overwrite': 'Overwrite',
    'action.renameAuto': 'Rename automatically',
    'action.cancel': 'Cancel',

    // Language menu
    'lang.auto': 'Auto',
    'lang.zh': '中文',
    'lang.en': 'English',

    // Context menu
    'ctx.newFile': 'New File Here',
    'ctx.newFolder': 'New Folder Here',
    'ctx.customIcon': 'Custom Icon',
    'ctx.moveTo': 'Move to…',
    'ctx.rename': 'Rename',
    'ctx.delete': 'Delete',
    'ctx.sortNameAsc': 'Sort by name A→Z',
    'ctx.sortNameDesc': 'Sort by name Z→A',
    'ctx.sortTimeDesc': 'Sort by time: newest first',
    'ctx.sortTimeAsc': 'Sort by time: oldest first',

    // Extensions & Plugins
    'ext.title': 'Extensions & Plugins',
    'ext.install.section': 'Install Extensions (GitHub or URL)',
    'ext.install.placeholder': 'Enter URL or username/repository@branch (branch optional)',
    'ext.install.btn': 'Install',
    'ext.builtin': 'Built-in Extensions',
    'ext.installed': 'Installed',
    'ext.available': 'Extension Marketplace',
    'ext.market.channel': 'Channel',
    'ext.market.channel.github': 'GitHub',
    'ext.market.channel.official': 'Official',
    'ext.refresh': 'Refresh',
      'ext.update.btn': 'Update',
      'ext.update.ok': 'Extension updated',
      'ext.update.fail': 'Failed to update extension',
      'ext.update.notice.single': 'Extension {name} has an update',
      'ext.update.notice.multi': '{count} extensions have updates: {names}',
    'ext.settings': 'Settings',
    'ext.settings.notProvided': 'This extension has no settings',
    'ext.settings.openFail': 'Failed to open extension settings',
    'ext.toggle.enable': 'Enable',
    'ext.toggle.disable': 'Disable',
    'ext.toggle.fail': 'Failed to toggle extension',
    'ext.remove': 'Remove',
    'ext.remove.confirm': 'Remove extension {name}?',
    'ext.removed': 'Extension removed',
    'ext.remove.fail': 'Failed to remove extension',
    'ext.install.ok': 'Installed',
    'ext.install.fail': 'Failed to install extension',
    'ext.enabled.tag.on': '✓ Enabled',
    'ext.enabled.tag.off': 'Disabled',
    'ext.author': 'Author:',
    'ext.homepage': 'Homepage',
    'ext.market.loading': 'Marketplace loading…',
  },
} as const

export function t(key: keyof typeof dict['zh'], params?: Record<string, string | number>): string {
  const locale = getLocale()
  let s = (dict as any)[locale]?.[key] ?? (dict as any)['zh']?.[key] ?? String(key)
  if (!params) return s
  try {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v))
    }
  } catch {}
  return s
}

export function fmtStatus(line: number, col: number): string {
  return t('status.pos', { line, col })
}
