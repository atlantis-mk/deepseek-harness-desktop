import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createReleaseManifest } from '../scripts/create-release-manifest.mjs'

test('creates a stable manifest for supported release assets', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-release-'))
  await writeFile(path.join(directory, 'app.dmg'), 'dmg')
  await writeFile(path.join(directory, 'app.exe'), 'exe')
  await writeFile(path.join(directory, 'builder-debug.yml'), 'ignored')
  const output = path.join(directory, 'latest.json')

  const manifest = await createReleaseManifest({
    input: directory,
    output,
    version: '1.2.3',
    baseUrl: 'https://downloads.example.com/',
    repository: 'owner/repo',
  })

  assert.equal(manifest.version, '1.2.3')
  assert.deepEqual(manifest.assets.map((asset) => asset.name), ['app.dmg', 'app.exe'])
  assert.equal(manifest.assets[0].url, 'https://downloads.example.com/deepseek-harness-desktop/releases/v1.2.3/app.dmg')
  assert.equal(manifest.assets[0].sha256.length, 64)
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), manifest)
})

test('rejects releases without installable assets', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-release-empty-'))
  await assert.rejects(
    createReleaseManifest({
      input: directory,
      output: path.join(directory, 'latest.json'),
      version: '1.2.3',
      baseUrl: 'https://downloads.example.com',
      repository: 'owner/repo',
    }),
    /No release assets/,
  )
})
