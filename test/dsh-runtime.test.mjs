import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  buildHarnessEnvironment,
  inspectDshPackage,
  isDshUpdateRequired,
} from '../src/dsh-runtime.mjs'

test('uses the same DSH_HOME as the command-line environment', () => {
  const withoutDshHome = buildHarnessEnvironment(
    { nodePath: '/managed/node/bin/node' },
    ['/global/bin'],
    { PATH: '/usr/bin' },
  )
  assert.equal(Object.hasOwn(withoutDshHome, 'DSH_HOME'), false)
  assert.equal(
    withoutDshHome.PATH,
    ['/managed/node/bin', '/global/bin', '/usr/bin'].join(path.delimiter),
  )

  const withDshHome = buildHarnessEnvironment(
    { nodePath: '/managed/node/bin/node' },
    [],
    { PATH: '/usr/bin', DSH_HOME: '/shared/dsh-home' },
  )
  assert.equal(withDshHome.DSH_HOME, '/shared/dsh-home')
})

test('detects an installed dsh package and its executable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-package-'))
  try {
    await mkdir(path.join(root, 'lib'), { recursive: true })
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: '@deepseek-ai/dsh',
        version: '0.1.0-rc.6',
        bin: { dsh: 'lib/bin.js' },
      }),
    )
    await writeFile(path.join(root, 'lib', 'bin.js'), '#!/usr/bin/env node\n')

    const installation = await inspectDshPackage(root, 'global')
    assert.ok(installation)
    assert.equal(installation.source, 'global')
    assert.equal(installation.version, '0.1.0-rc.6')
    assert.equal(installation.binPath, path.join(root, 'lib', 'bin.js'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects damaged or unrelated global packages', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-package-invalid-'))
  try {
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'another-package', version: '1.0.0', bin: 'bin.js' }),
    )
    assert.equal(await inspectDshPackage(root), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('updates dsh only when the installed version is older', () => {
  assert.equal(isDshUpdateRequired('0.1.0-rc.5', '0.1.0-rc.6'), true)
  assert.equal(isDshUpdateRequired('0.1.0-rc.6', '0.1.0-rc.6'), false)
  assert.equal(isDshUpdateRequired('0.2.0', '0.1.0-rc.6'), false)
  assert.equal(isDshUpdateRequired('invalid', '0.1.0-rc.6'), false)
})
