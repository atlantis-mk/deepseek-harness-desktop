import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import semver from 'semver'
import { inspectDshPackage } from './dsh-runtime.mjs'
import { isCompatibleNodeVersion } from './node-runtime.mjs'

const STARTUP_CACHE_VERSION = 1

async function pathsExist(paths) {
  try {
    await Promise.all(paths.map((filePath) => access(filePath)))
    return true
  } catch {
    return false
  }
}

export async function readStartupCache(
  cachePath,
  { platform = process.platform, arch = process.arch } = {},
) {
  try {
    const cached = JSON.parse(await readFile(cachePath, 'utf8'))
    if (
      cached?.cacheVersion !== STARTUP_CACHE_VERSION ||
      cached.platform !== platform ||
      cached.arch !== arch
    ) {
      return null
    }

    const node = cached.nodeEnvironment
    const dsh = cached.dshInstallation
    const nodeVersion = semver.clean(node?.version)
    if (
      !['system', 'managed'].includes(node?.source) ||
      !nodeVersion ||
      !isCompatibleNodeVersion(nodeVersion) ||
      typeof node.nodePath !== 'string' ||
      typeof node.npxCliPath !== 'string' ||
      typeof dsh?.packageRoot !== 'string' ||
      typeof dsh.binDir !== 'string'
    ) {
      return null
    }
    if (!(await pathsExist([node.nodePath, node.npxCliPath, dsh.binDir]))) return null

    // Reading the installed package manifest is cheap and protects the fast path
    // from stale caches after a user removes or changes the global installation.
    const installation = await inspectDshPackage(dsh.packageRoot, dsh.source)
    if (!installation) return null

    return {
      nodeEnvironment: {
        source: node.source,
        version: nodeVersion,
        nodePath: path.resolve(node.nodePath),
        npxCliPath: path.resolve(node.npxCliPath),
      },
      dshInstallation: {
        ...installation,
        binDir: path.resolve(dsh.binDir),
      },
    }
  } catch {
    return null
  }
}

export async function writeStartupCache(
  cachePath,
  nodeEnvironment,
  dshInstallation,
  { platform = process.platform, arch = process.arch } = {},
) {
  const value = {
    cacheVersion: STARTUP_CACHE_VERSION,
    platform,
    arch,
    nodeEnvironment: {
      source: nodeEnvironment.source,
      version: nodeEnvironment.version,
      nodePath: nodeEnvironment.nodePath,
      npxCliPath: nodeEnvironment.npxCliPath,
    },
    dshInstallation: {
      source: dshInstallation.source,
      packageRoot: dshInstallation.packageRoot,
      binDir: dshInstallation.binDir,
    },
  }
  await mkdir(path.dirname(cachePath), { recursive: true })
  await writeFile(cachePath, `${JSON.stringify(value)}\n`, 'utf8')
}
