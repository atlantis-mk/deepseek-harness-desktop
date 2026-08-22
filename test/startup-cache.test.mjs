import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { readStartupCache, writeStartupCache } from '../src/startup-cache.mjs'

test('reuses valid cached Node and DSH installations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-startup-cache-'))
  const cachePath = path.join(root, 'cache', 'startup.json')
  const nodePath = path.join(root, 'runtime', 'bin', 'node')
  const npxCliPath = path.join(root, 'runtime', 'npm', 'npx-cli.js')
  const packageRoot = path.join(root, 'runtime', 'lib', 'node_modules', '@deepseek-ai', 'dsh')
  const binDir = path.join(root, 'runtime', 'bin')
  try {
    await mkdir(path.dirname(nodePath), { recursive: true })
    await mkdir(path.dirname(npxCliPath), { recursive: true })
    await mkdir(path.join(packageRoot, 'lib'), { recursive: true })
    await Promise.all([
      writeFile(nodePath, ''),
      writeFile(npxCliPath, ''),
      writeFile(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({
          name: '@deepseek-ai/dsh',
          version: '0.1.0-rc.6',
          bin: { dsh: 'lib/bin.js' },
        }),
      ),
      writeFile(path.join(packageRoot, 'lib', 'bin.js'), ''),
    ])

    await writeStartupCache(
      cachePath,
      {
        source: 'managed',
        version: '24.12.0',
        nodePath,
        npxCliPath,
      },
      {
        source: 'global',
        packageRoot,
        binDir,
      },
    )

    const cached = await readStartupCache(cachePath)
    assert.ok(cached)
    assert.equal(cached.nodeEnvironment.nodePath, nodePath)
    assert.equal(cached.dshInstallation.version, '0.1.0-rc.6')
    assert.equal(cached.dshInstallation.binDir, binDir)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects stale startup paths and caches from another platform', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-startup-cache-invalid-'))
  const cachePath = path.join(root, 'startup.json')
  try {
    await writeFile(
      cachePath,
      JSON.stringify({
        cacheVersion: 1,
        platform: process.platform,
        arch: process.arch,
        nodeEnvironment: {
          source: 'managed',
          version: '24.12.0',
          nodePath: path.join(root, 'missing-node'),
          npxCliPath: path.join(root, 'missing-npx'),
        },
        dshInstallation: {
          source: 'global',
          packageRoot: path.join(root, 'missing-dsh'),
          binDir: root,
        },
      }),
    )
    assert.equal(await readStartupCache(cachePath), null)
    assert.equal(
      await readStartupCache(cachePath, { platform: 'different', arch: process.arch }),
      null,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
