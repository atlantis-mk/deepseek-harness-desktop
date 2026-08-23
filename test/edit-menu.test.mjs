import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createApplicationMenuTemplate,
  createWebContextMenuTemplate,
} from '../src/edit-menu.mjs'

test('application menu exposes standard editing commands', () => {
  const template = createApplicationMenuTemplate()
  const editMenu = template.find((item) => item.label === '编辑')
  const roles = editMenu.submenu.map((item) => item.role).filter(Boolean)

  assert.deepEqual(roles, ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])
})

test('read-only context menu enables copying only when text is selected', () => {
  const selected = createWebContextMenuTemplate({ selectionText: '一段文本' })
  const unselected = createWebContextMenuTemplate({ selectionText: '' })

  assert.equal(selected.find((item) => item.role === 'copy').enabled, true)
  assert.equal(unselected.find((item) => item.role === 'copy').enabled, false)
  assert.ok(selected.some((item) => item.role === 'selectAll'))
})

test('editable context menu follows Chromium edit capabilities', () => {
  const template = createWebContextMenuTemplate({
    isEditable: true,
    editFlags: {
      canUndo: false,
      canRedo: true,
      canCut: true,
      canCopy: true,
      canPaste: false,
      canSelectAll: true,
    },
  })

  assert.equal(template.find((item) => item.role === 'undo').enabled, false)
  assert.equal(template.find((item) => item.role === 'redo').enabled, true)
  assert.equal(template.find((item) => item.role === 'copy').enabled, true)
  assert.equal(template.find((item) => item.role === 'paste').enabled, false)
})

test('link context menu can open links externally', () => {
  let opened = null
  let copied = null
  const template = createWebContextMenuTemplate(
    { linkURL: 'https://example.com', selectionText: '' },
    {
      copyText: (text) => { copied = text },
      openExternal: (url) => { opened = url },
    },
  )

  template.find((item) => item.label.includes('打开链接')).click()
  template.find((item) => item.label.includes('复制链接')).click()
  assert.equal(opened, 'https://example.com')
  assert.equal(copied, 'https://example.com')
})

test('link context menu rejects unsafe URL schemes', () => {
  for (const linkURL of ['file:///etc/passwd', 'javascript:alert(1)', 'not a url']) {
    const template = createWebContextMenuTemplate(
      { linkURL, selectionText: '' },
      {
        copyText: () => assert.fail(`must not copy ${linkURL}`),
        openExternal: () => assert.fail(`must not open ${linkURL}`),
      },
    )

    assert.equal(template.some((item) => item.label?.includes('链接')), false)
  }
})
