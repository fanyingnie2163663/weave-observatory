#!/usr/bin/env node
/**
 * Install/enable dsh-client-ui-weave in a DSH desktop profile.
 * Default is a dry run; pass --apply to write. The user must confirm first.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const profileArgIndex = args.indexOf('--profile')
const profile = profileArgIndex >= 0 ? args[profileArgIndex + 1] : (process.env.DSH_PROFILE_DIR || path.join(os.homedir(), '.dsh', 'profiles', 'desktop'))
const pluginDir = path.dirname(fileURLToPath(import.meta.url))
const packageJsonPath = path.join(profile, 'package.json')
const nodeModulesLink = path.join(profile, 'node_modules', 'dsh-client-ui-weave')

function fail(message) { console.error('weave install: ' + message); process.exit(1) }
if (!fs.existsSync(packageJsonPath)) fail('profile package.json not found: ' + packageJsonPath)

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
if (pkg.dependencies === undefined) pkg.dependencies = {}
if (pkg.dsh === undefined) pkg.dsh = {}
if (pkg.dsh.profile === undefined) pkg.dsh.profile = {}
if (!Array.isArray(pkg.dsh.profile.bundles)) pkg.dsh.profile.bundles = []
const nextDeps = Object.assign({}, pkg.dependencies)
nextDeps['dsh-client-ui-weave'] = 'file:' + pluginDir.replace(/\\/g, '/')
const nextBundles = pkg.dsh.profile.bundles.slice()
if (!nextBundles.includes('dsh-client-ui-weave')) nextBundles.push('dsh-client-ui-weave')
const linkExists = fs.existsSync(nodeModulesLink)

console.log('weave install: profile =', profile)
console.log('weave install: plugin  =', pluginDir)
console.log('weave install: 1) add dependency "dsh-client-ui-weave": "' + nextDeps['dsh-client-ui-weave'] + '"')
console.log('weave install: 2) append "dsh-client-ui-weave" to dsh.profile.bundles (current: ' + nextBundles.length + ' entries)')
console.log('weave install: 3) link node_modules/dsh-client-ui-weave -> ' + pluginDir + ' (exists: ' + linkExists + ')')
console.log('weave install: 4) reload DSH (full quit + reopen) so the host loader composes the new bundle')

if (!apply) {
  console.log('weave install: dry run only. Re-run with --apply after the user confirms.')
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
fs.copyFileSync(packageJsonPath, packageJsonPath + '.bak-weave-' + stamp)
pkg.dependencies = nextDeps
pkg.dsh.profile.bundles = nextBundles
fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n')
console.log('weave install: wrote profile package.json (backup: package.json.bak-weave-' + stamp + ')')

if (!linkExists) {
  fs.mkdirSync(path.dirname(nodeModulesLink), { recursive: true })
  fs.symlinkSync(pluginDir, nodeModulesLink, 'junction')
  console.log('weave install: created node_modules junction')
} else {
  console.log('weave install: node_modules entry already present')
}

console.log('weave install: done. Now quit DSH completely and reopen it, then open a session and choose the 织造 tab.')
console.log('weave install: uninstall by removing the dependency + bundles entry and node_modules junction.')
