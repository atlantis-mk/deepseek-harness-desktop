import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import {
  MANAGED_NODE_VERSION,
  REQUIRED_NODE_RANGE,
  getNodeArtifact,
  inspectNodeInstallation,
  isCompatibleNodeVersion,
  validateZipEntry,
} from '../src/node-runtime.mjs'

test('accepts the Node versions supported by DeepSeek Harness', () => {
  assert.equal(isCompatibleNodeVersion('v22.19.0'), true)
  assert.equal(isCompatibleNodeVersion('22.22.1'), true)
  assert.equal(isCompatibleNodeVersion('v24.0.0'), true)
  assert.equal(isCompatibleNodeVersion('v26.1.0'), true)
})

test('rejects incompatible or malformed Node versions', () => {
  assert.equal(isCompatibleNodeVersion('v22.18.0'), false)
  assert.equal(isCompatibleNodeVersion('v20.19.0'), false)
  assert.equal(isCompatibleNodeVersion('not-a-version'), false)
})

test('maps every supported desktop platform and architecture to a verified artifact', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    for (const arch of ['x64', 'arm64']) {
      const artifact = getNodeArtifact(platform, arch)
      assert.match(artifact.file, new RegExp(`node-v${MANAGED_NODE_VERSION}`))
      assert.match(artifact.sha256, /^[a-f0-9]{64}$/)
      assert.ok(['tar.gz', 'zip'].includes(artifact.archive))
    }
  }
})

test('rejects unsupported private-runtime targets with an actionable error', () => {
  assert.throws(
    () => getNodeArtifact('linux', 'riscv64'),
    new RegExp(`请安装满足 ${REQUIRED_NODE_RANGE.replaceAll('+', '\\+')}`),
  )
})

test('rejects ZIP traversal, absolute paths, drive paths, and symlinks by path', () => {
  const root = '/tmp/safe-node-runtime'
  assert.throws(() => validateZipEntry('../escape', root), /不安全路径/)
  assert.throws(() => validateZipEntry('/absolute/path', root), /不安全路径/)
  assert.throws(() => validateZipEntry('C:\\escape\\node.exe', root), /不安全路径/)
  assert.equal(
    validateZipEntry('node-v24/bin/node', root).destination,
    path.resolve(root, 'node-v24/bin/node'),
  )
})

test('detects the current development Node installation when npm is available', async () => {
  const installation = await inspectNodeInstallation(process.execPath, process.platform)
  assert.ok(installation)
  assert.equal(installation.source, 'system')
  assert.equal(installation.nodePath, process.execPath)
  assert.match(installation.npxCliPath, /npx-cli\.js$/)
})
