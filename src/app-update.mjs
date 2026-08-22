import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import semver from 'semver'

export const DESKTOP_UPDATE_MANIFEST_URL =
  'https://pub-bf5092e77ab5409ba39fb34c4a76c1b1.r2.dev/deepseek-harness-desktop/latest.json'

const platformNames = {
  darwin: 'mac',
  linux: 'linux',
  win32: 'win',
}

function isReleaseAsset(asset) {
  if (!asset || typeof asset !== 'object') return false
  if (
    typeof asset.name !== 'string' ||
    path.posix.basename(asset.name) !== asset.name ||
    path.win32.basename(asset.name) !== asset.name
  ) {
    return false
  }
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0) return false
  if (typeof asset.sha256 !== 'string' || !/^[a-f\d]{64}$/i.test(asset.sha256)) return false
  try {
    return new URL(asset.url).protocol === 'https:'
  } catch {
    return false
  }
}

export function parseReleaseManifest(value) {
  if (!value || typeof value !== 'object') throw new Error('更新清单不是有效对象。')
  if (value.schemaVersion !== 1) throw new Error('更新清单版本不受支持。')
  if (!semver.valid(value.version)) throw new Error('更新清单中的版本号无效。')
  if (!Array.isArray(value.assets) || value.assets.length === 0) {
    throw new Error('更新清单没有可用的安装包。')
  }
  if (!value.assets.every(isReleaseAsset)) throw new Error('更新清单包含无效的安装包信息。')
  return value
}

export function selectReleaseAsset(manifest, { platform, arch, isAppImage = false }) {
  const platformName = platformNames[platform]
  if (!platformName || !['x64', 'arm64'].includes(arch)) return null

  const prefix = `DeepSeek-Harness-Desktop-${manifest.version}-${platformName}-`
  let packageNames
  if (platform === 'darwin') {
    packageNames = [`${arch}.dmg`]
  } else if (platform === 'win32') {
    packageNames = [`${arch}.exe`]
  } else {
    const appImageArch = arch === 'x64' ? 'x86_64' : 'arm64'
    const debArch = arch === 'x64' ? 'amd64' : 'arm64'
    packageNames = isAppImage
      ? [`${appImageArch}.AppImage`, `${debArch}.deb`]
      : [`${debArch}.deb`, `${appImageArch}.AppImage`]
  }

  for (const packageName of packageNames) {
    const asset = manifest.assets.find((candidate) => candidate.name === `${prefix}${packageName}`)
    if (asset) return asset
  }
  return null
}

export async function fetchAvailableUpdate({
  fetchImpl,
  currentVersion,
  platform,
  arch,
  isAppImage = false,
  manifestUrl = DESKTOP_UPDATE_MANIFEST_URL,
}) {
  if (!semver.valid(currentVersion)) throw new Error(`当前应用版本无效：${currentVersion}`)
  const response = await fetchImpl(manifestUrl, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`更新服务返回 HTTP ${response.status}`)

  const manifest = parseReleaseManifest(await response.json())
  if (!semver.gt(manifest.version, currentVersion)) return null

  const asset = selectReleaseAsset(manifest, { platform, arch, isAppImage })
  if (!asset) throw new Error(`版本 ${manifest.version} 没有适用于 ${platform}/${arch} 的安装包。`)
  return { manifest, asset }
}

export async function verifyReleaseAsset(file, asset) {
  try {
    const metadata = await stat(file)
    if (!metadata.isFile() || metadata.size !== asset.size) return false
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(file)) hash.update(chunk)
    const sha256 = hash.digest('hex')
    return sha256.toLowerCase() === asset.sha256.toLowerCase()
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

export async function downloadReleaseAsset({ fetchImpl, asset, destination, onProgress }) {
  await mkdir(path.dirname(destination), { recursive: true })
  if (await verifyReleaseAsset(destination, asset)) {
    onProgress?.({ received: asset.size, total: asset.size, cached: true })
    return destination
  }

  const partial = `${destination}.download`
  await rm(partial, { force: true })
  await rm(destination, { force: true })

  const response = await fetchImpl(asset.url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(30 * 60_000),
  })
  if (!response.ok || !response.body) {
    throw new Error(`下载安装包失败（HTTP ${response.status}）。`)
  }

  const handle = await open(partial, 'wx')
  const hash = createHash('sha256')
  let received = 0
  try {
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > asset.size) throw new Error('下载内容超过更新清单声明的大小。')
      hash.update(value)
      let offset = 0
      while (offset < value.byteLength) {
        const { bytesWritten } = await handle.write(
          value,
          offset,
          value.byteLength - offset,
        )
        if (bytesWritten === 0) throw new Error('无法写入桌面端更新文件。')
        offset += bytesWritten
      }
      onProgress?.({ received, total: asset.size, cached: false })
    }
  } catch (error) {
    await handle.close()
    await rm(partial, { force: true })
    throw error
  }
  await handle.close()

  const digest = hash.digest('hex')
  if (received !== asset.size || digest.toLowerCase() !== asset.sha256.toLowerCase()) {
    await rm(partial, { force: true })
    throw new Error('安装包完整性校验失败，已丢弃本次下载。')
  }

  await rename(partial, destination)
  return destination
}
