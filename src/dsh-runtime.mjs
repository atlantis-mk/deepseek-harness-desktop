import { access, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import semver from 'semver'

const execFileAsync = promisify(execFile)

export const DSH_PACKAGE_NAME = '@deepseek-ai/dsh'

export function buildHarnessEnvironment(
  nodeEnvironment,
  additionalBinDirs = [],
  env = process.env,
) {
  const nodeDir = path.dirname(nodeEnvironment.nodePath)
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  const inheritedPath = env[pathKey] ?? ''
  return {
    ...env,
    [pathKey]: [nodeDir, ...additionalBinDirs, inheritedPath]
      .filter(Boolean)
      .join(path.delimiter),
    npm_config_progress: 'false',
  }
}

function npmCliPath(nodeEnvironment) {
  return path.join(path.dirname(nodeEnvironment.npxCliPath), 'npm-cli.js')
}

async function commandOutput(command, args, options = {}) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      ...options,
    })
    return stdout.trim()
  } catch {
    return ''
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export async function inspectDshPackage(packageRoot, source = 'unknown') {
  try {
    const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
    if (manifest.name !== DSH_PACKAGE_NAME) return null
    const version = semver.clean(manifest.version)
    const binEntry =
      typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.dsh
    if (!version || typeof binEntry !== 'string') return null
    const binPath = path.resolve(packageRoot, binEntry)
    if (!(await fileExists(binPath))) return null
    return {
      source,
      version,
      packageRoot: path.resolve(packageRoot),
      binPath,
    }
  } catch {
    return null
  }
}

async function packageFromBin(binPath, source) {
  let candidate
  try {
    candidate = await realpath(binPath)
  } catch {
    candidate = path.resolve(binPath)
  }

  let directory = path.dirname(candidate)
  for (let depth = 0; depth < 6; depth += 1) {
    const installation = await inspectDshPackage(directory, source)
    if (installation) return installation
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }

  return inspectDshPackage(
    path.join(path.dirname(binPath), 'node_modules', '@deepseek-ai', 'dsh'),
    source,
  )
}

async function findPathInstallation(platform, env) {
  const candidates = []
  if (env.DSH_DESKTOP_DSH) candidates.push(env.DSH_DESKTOP_DSH)

  if (platform === 'win32') {
    const output = await commandOutput('where.exe', ['dsh.cmd'], { env })
    if (output) candidates.push(...output.split(/\r?\n/))
  } else {
    const direct = await commandOutput('/usr/bin/env', ['sh', '-c', 'command -v dsh'], { env })
    if (direct) candidates.push(direct)
    const shell = env.SHELL
    if (shell && path.isAbsolute(shell)) {
      const login = await commandOutput(shell, ['-lic', 'command -v dsh'], { env })
      if (login) candidates.push(login.split(/\r?\n/).at(-1))
    }
  }

  for (const candidate of [...new Set(candidates.map((item) => item.trim()).filter(Boolean))]) {
    const installation = await packageFromBin(candidate, 'path')
    if (installation) return { ...installation, binDir: path.dirname(candidate) }
  }
  return null
}

async function resolveGlobalNpmPaths(nodeEnvironment, platform, env) {
  const [root, prefix] = await Promise.all([
    commandOutput(
      nodeEnvironment.nodePath,
      [npmCliPath(nodeEnvironment), 'root', '--global'],
      { env },
    ),
    commandOutput(
      nodeEnvironment.nodePath,
      [npmCliPath(nodeEnvironment), 'prefix', '--global'],
      { env },
    ),
  ])
  if (!root || !prefix) return null
  return {
    root: path.resolve(root),
    prefix: path.resolve(prefix),
    binDir: platform === 'win32' ? path.resolve(prefix) : path.resolve(prefix, 'bin'),
  }
}

async function findGlobalInstallation(nodeEnvironment, platform, env) {
  const npmPaths = await resolveGlobalNpmPaths(nodeEnvironment, platform, env)
  if (!npmPaths) return null
  const installation = await inspectDshPackage(
    path.join(npmPaths.root, '@deepseek-ai', 'dsh'),
    'global',
  )
  return installation ? { ...installation, ...npmPaths } : null
}

export async function findUserDshInstallation({
  nodeEnvironment,
  platform = process.platform,
  env = process.env,
  includePath = true,
}) {
  const globalInstallation = await findGlobalInstallation(nodeEnvironment, platform, env)
  if (globalInstallation) return globalInstallation

  if (!includePath) return null
  return findPathInstallation(platform, env)
}

export function isDshUpdateRequired(installedVersion, latestVersion) {
  const installed = semver.clean(installedVersion)
  const latest = semver.clean(latestVersion)
  return Boolean(installed && latest && semver.lt(installed, latest))
}

export async function updateGlobalDsh({
  nodeEnvironment,
  version,
  platform = process.platform,
  env = process.env,
}) {
  await execFileAsync(
    nodeEnvironment.nodePath,
    [npmCliPath(nodeEnvironment), 'install', '--global', `${DSH_PACKAGE_NAME}@${version}`],
    {
      env,
      encoding: 'utf8',
      timeout: 5 * 60_000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    },
  )
  return findGlobalInstallation(nodeEnvironment, platform, env)
}

export async function getGlobalNpmBinDirectory({
  nodeEnvironment,
  platform = process.platform,
  env = process.env,
}) {
  const npmPaths = await resolveGlobalNpmPaths(nodeEnvironment, platform, env)
  return npmPaths?.binDir ?? null
}
