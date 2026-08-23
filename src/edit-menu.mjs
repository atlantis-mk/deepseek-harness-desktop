const editRoles = [
  'undo',
  'redo',
  'separator',
  'cut',
  'copy',
  'paste',
  'selectAll',
]

export function createApplicationMenuTemplate() {
  return [
    { role: 'appMenu' },
    {
      label: '编辑',
      submenu: editRoles.map((role) =>
        role === 'separator' ? { type: 'separator' } : { role },
      ),
    },
  ]
}

function isAllowedExternalLink(value) {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function createWebContextMenuTemplate(
  params,
  { copyText, openExternal } = {},
) {
  const items = []
  const editFlags = params.editFlags ?? {}

  if (isAllowedExternalLink(params.linkURL)) {
    items.push(
      {
        label: '在默认浏览器中打开链接',
        click: () => openExternal?.(params.linkURL),
      },
      {
        label: '复制链接地址',
        click: () => copyText?.(params.linkURL),
      },
      { type: 'separator' },
    )
  }

  if (params.isEditable) {
    items.push(
      { label: '撤销', role: 'undo', enabled: Boolean(editFlags.canUndo) },
      { label: '重做', role: 'redo', enabled: Boolean(editFlags.canRedo) },
      { type: 'separator' },
      { label: '剪切', role: 'cut', enabled: Boolean(editFlags.canCut) },
      { label: '复制', role: 'copy', enabled: Boolean(editFlags.canCopy) },
      { label: '粘贴', role: 'paste', enabled: Boolean(editFlags.canPaste) },
      { type: 'separator' },
      { label: '全选', role: 'selectAll', enabled: Boolean(editFlags.canSelectAll) },
    )
  } else {
    items.push(
      { label: '复制', role: 'copy', enabled: Boolean(params.selectionText) },
      { label: '全选', role: 'selectAll' },
    )
  }

  return items
}
