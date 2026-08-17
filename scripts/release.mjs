#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import semver from 'semver'

const requestedVersion = process.argv[2]
const dryRun = process.argv.includes('--dry-run')

function fail(message) {
  console.error(`release: ${message}`)
  process.exit(1)
}

function run(command, args, options = {}) {
  const rendered = [command, ...args].join(' ')
  if (dryRun && options.mutates) {
    console.log(`[dry-run] ${rendered}`)
    return ''
  }
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  }).trim()
}

if (!requestedVersion || !semver.valid(requestedVersion) || semver.prerelease(requestedVersion)) {
  fail('pass a stable SemVer without a leading v, for example: npm run release -- 0.2.0')
}

const branch = run('git', ['branch', '--show-current'], { capture: true })
if (branch !== 'main') {
  fail(`releases must be created from main, not ${branch || '(detached HEAD)'}`)
}

if (run('git', ['status', '--porcelain'], { capture: true })) {
  fail('working tree is not clean; commit or stash changes first')
}

run('git', ['fetch', '--tags', 'origin'])
const remoteHead = run('git', ['rev-parse', 'origin/main'], { capture: true })
const localHead = run('git', ['rev-parse', 'HEAD'], { capture: true })
if (remoteHead !== localHead) {
  fail('main must exactly match origin/main before releasing')
}

const tag = `v${requestedVersion}`
try {
  run('git', ['rev-parse', '--verify', `refs/tags/${tag}`], { capture: true })
  fail(`tag ${tag} already exists`)
} catch (error) {
  if (error.status !== 128) throw error
}

const currentVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version
if (currentVersion !== requestedVersion) {
  run('npm', ['version', requestedVersion, '--no-git-tag-version'], { mutates: true })
}

run('npm', ['test'])

if (currentVersion !== requestedVersion) {
  run('git', ['add', 'package.json', 'package-lock.json'], { mutates: true })
  run('git', ['commit', '-m', `release: ${tag}`], { mutates: true })
}

run('git', ['tag', '-a', tag, '-m', `DeepSeek Harness Desktop ${tag}`], { mutates: true })
run('git', ['push', 'origin', 'main', tag], { mutates: true })

console.log(`${dryRun ? 'Would publish' : 'Published'} ${tag}. Follow the workflow at:`)
console.log(`https://github.com/atlantis-mk/deepseek-harness-desktop/actions/workflows/release.yml`)
