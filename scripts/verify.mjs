#!/usr/bin/env node
// Verifies verified.json: the file itself (schema, ids, order, format) and,
// for each card entry, the package it points at — downloaded from GitHub at
// the pinned commit exactly the way the NeuroSquad app installs it.
//
//   node scripts/verify.mjs                          every entry
//   node scripts/verify.mjs --changed-only <base>    only entries new or changed since <base>
//                                                    (a git ref; "base..head" is accepted too —
//                                                    the working-tree file is always the "head")
//   node scripts/verify.mjs --id <id> [--id <id>]    only these entries
//   node scripts/verify.mjs --offline                only the file checks (no network)
//   node scripts/verify.mjs entry <owner/repo[/path]> [--commit <sha>]
//                                                    print a draft entry computed from GitHub
//   node scripts/verify.mjs format                   rewrite verified.json in canonical form
//
// GitHub token: GITHUB_TOKEN or GH_TOKEN, else `gh auth token` if the GitHub CLI
// is signed in. Without one, unauthenticated API limits apply (60 requests/hour).
//
// How the app computes a package's tree hash (and how this script does the same):
//   apps/desktop/src/main/cardSdk/install/tarball.ts + shared/cardSdk/source.ts
//   1. GET https://api.github.com/repos/{owner}/{repo}/tarball/{commit} (the whole
//      repository at that commit, redirected to codeload.github.com);
//   2. read the .tar.gz: ustar + GNU long names + pax path/size; only regular
//      files are kept (links and other types are skipped); every entry name
//      goes through archiveEntryToPackagePath(name, subdir) — the first path
//      segment (GitHub's "<repo>-<sha>/" folder) is dropped, entries outside
//      `subdir` are ignored, unsafe names abort;
//   3. sha256 of each file's bytes; the tree hash is
//      sha256(treeHashInput(files)) where treeHashInput is one line
//      "<sha256 hex>  <path>\n" per file, sorted by path (UTF-16 order).
// `archiveEntryToPackagePath`, `treeHashInput`, `parseManifestText`,
// `impersonationIssues` and `LIMITS` are imported from @neurosquad/card-sdk —
// the generated copy of the app's own contract — not reimplemented here.
// As a cross-check, the SDK's `neurosquad-card pack --dry-run` is run on the
// extracted folder and must print the same tree hash.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import {
  archiveEntryToPackagePath,
  impersonationIssues,
  LIMITS,
  MANIFEST_FILE,
  parseManifestText,
  PERMISSION_IDS,
  treeHashInput
} from '@neurosquad/card-sdk'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG = join(ROOT, 'verified.json')
const SCHEMA = join(ROOT, 'verified.schema.json')
const API = 'https://api.github.com'

/** The organization whose cards are "official" — the same two facts the app checks. */
const OFFICIAL_OWNER = 'glmn-ai'
const OFFICIAL_OWNER_ID = 327467700
/** This catalog's own repository (may be private while it is being set up). */
const CATALOG_REPO = 'glmn-ai/neurosquad-cards'

/** Canonical key order of an entry (also the order `format` writes). */
const ENTRY_KEYS = [
  'id',
  'packageId',
  'name',
  'description',
  'author',
  'repo',
  'path',
  'version',
  'commit',
  'treeHash',
  'permissions',
  'optionalPermissions',
  'networkHosts',
  'tags',
  'category',
  'license',
  'homepage',
  'icon',
  'screenshots',
  'minAppVersion',
  'official',
  'verifiedAt',
  'reviewer',
  'notes'
]

// --- output -------------------------------------------------------------------

const IN_ACTIONS = process.env.GITHUB_ACTIONS === 'true'
const color = (code) => (text) =>
  process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${text}\x1b[0m` : text
const red = color(31)
const green = color(32)
const yellow = color(33)
const dim = color(2)
const bold = color(1)

let errorCount = 0
let warningCount = 0

function error(where, message) {
  errorCount++
  console.log(`  ${red('✖')} ${where ? `${bold(where)}: ` : ''}${message}`)
  if (IN_ACTIONS) console.log(`::error title=verified.json${where ? ` ${where}` : ''}::${escapeAnnotation(message)}`)
}

function warning(where, message) {
  warningCount++
  console.log(`  ${yellow('▲')} ${where ? `${bold(where)}: ` : ''}${message}`)
  if (IN_ACTIONS) console.log(`::warning title=verified.json${where ? ` ${where}` : ''}::${escapeAnnotation(message)}`)
}

function ok(message) {
  console.log(`  ${green('✔')} ${message}`)
}

function escapeAnnotation(text) {
  return String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

class Fatal extends Error {}

// --- GitHub -------------------------------------------------------------------

let cachedToken
function githubToken() {
  if (cachedToken !== undefined) return cachedToken
  cachedToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
  if (!cachedToken) {
    const gh = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', windowsHide: true })
    if (gh.status === 0 && gh.stdout.trim()) cachedToken = gh.stdout.trim()
  }
  return cachedToken
}

async function github(path, { accept = 'application/vnd.github+json', raw = false } = {}) {
  const headers = {
    Accept: accept,
    'User-Agent': 'neurosquad-cards-verify',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  const token = githubToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let response
  for (let attempt = 1; ; attempt++) {
    try {
      response = await fetch(`${API}${path}`, { headers, redirect: 'follow' })
    } catch (cause) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * attempt))
        continue
      }
      throw new Fatal(`GET ${path}: ${cause.message}`)
    }
    if (response.status >= 500 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * attempt))
      continue
    }
    break
  }
  if ((response.status === 403 || response.status === 429) && response.headers.get('x-ratelimit-remaining') === '0') {
    throw new Fatal(`GitHub rate limit reached (GET ${path}) — set GITHUB_TOKEN`)
  }
  if (!response.ok) return { status: response.status, body: null }
  if (raw) {
    const final = new URL(response.url)
    const buffer = Buffer.from(await response.arrayBuffer())
    return { status: response.status, body: buffer, finalHost: final.host }
  }
  const text = await response.text()
  return { status: response.status, body: accept.endsWith('.sha') ? text.trim() : JSON.parse(text) }
}

// --- archive (mirrors apps/desktop/src/main/cardSdk/install/tarball.ts) --------

const BLOCK = 512
const MAX_META_BYTES = 1024 * 1024
const TAR_LIMITS = {
  compressedBytes: LIMITS.tarballBytes,
  streamBytes: LIMITS.unpackedBytes * 5,
  files: LIMITS.files,
  fileBytes: LIMITS.fileBytes,
  totalBytes: LIMITS.unpackedBytes
}

const padded = (size) => Math.ceil(size / BLOCK) * BLOCK

function cString(buffer, offset, length) {
  const slice = buffer.subarray(offset, offset + length)
  const nul = slice.indexOf(0)
  return (nul === -1 ? slice : slice.subarray(0, nul)).toString('utf8')
}

function parseNumeric(header, offset, length) {
  const field = header.subarray(offset, offset + length)
  if (field[0] & 0x80) {
    // base-256 (GNU): big-endian, top bit of the first byte is the marker
    let value = field[0] & 0x7f
    for (let i = 1; i < field.length; i++) value = value * 256 + field[i]
    if (!Number.isSafeInteger(value)) throw new Fatal('tar number out of range')
    return value
  }
  const text = cString(header, offset, length).trim()
  if (text === '') return 0
  if (!/^[0-7]+$/.test(text)) throw new Fatal('bad tar number')
  return parseInt(text, 8)
}

function checksumOk(header) {
  const stored = parseNumeric(header, 148, 8)
  let sum = 0
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i]
  return sum === stored
}

function parsePax(body) {
  const out = {}
  let offset = 0
  while (offset < body.length) {
    const space = body.indexOf(0x20, offset)
    if (space === -1) break
    const length = parseInt(body.subarray(offset, space).toString('latin1'), 10)
    if (!Number.isFinite(length) || length <= 0 || offset + length > body.length) break
    const record = body.subarray(space + 1, offset + length - 1).toString('utf8')
    const eq = record.indexOf('=')
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1)
    offset += length
  }
  return out
}

/**
 * Reads a GitHub tarball the way the app does and returns the package files
 * under `subdir` with their sha256, the tree hash and skipped-entry warnings.
 * Writes the files into `destDir` when given (for the SDK's validate/pack).
 */
export function readPackageFromTarball(archive, subdir, destDir) {
  if (archive.length > TAR_LIMITS.compressedBytes) {
    throw new Fatal(`the repository archive is ${archive.length} bytes; the app accepts at most ${TAR_LIMITS.compressedBytes}`)
  }
  let tar
  try {
    tar = gunzipSync(archive, { maxOutputLength: TAR_LIMITS.streamBytes })
  } catch (cause) {
    if (cause.code === 'ERR_BUFFER_TOO_LARGE') throw new Fatal('archive expands beyond the size limit')
    throw new Fatal('not a valid .tar.gz')
  }
  const files = []
  const warnings = []
  const fileKeys = new Set()
  const dirKeys = new Set()
  let totalBytes = 0
  let globalPax = {}
  let nextPax = {}
  let longName = null
  let offset = 0

  const read = (n) => {
    if (offset + n > tar.length) throw new Fatal('archive is truncated')
    const out = tar.subarray(offset, offset + n)
    offset += n
    return out
  }
  const claimDir = (path) => {
    const key = path.toLowerCase()
    if (fileKeys.has(key)) throw new Fatal(`"${path}" is both a file and a folder`)
    dirKeys.add(key)
  }

  for (;;) {
    if (offset + BLOCK > tar.length) break
    const header = read(BLOCK)
    if (header.every((byte) => byte === 0)) break
    if (!checksumOk(header)) throw new Fatal('tar header checksum mismatch')
    const type = String.fromCharCode(header[156])
    let entrySize = parseNumeric(header, 124, 12)

    if (type === 'x' || type === 'g' || type === 'L' || type === 'K') {
      if (entrySize > MAX_META_BYTES) throw new Fatal('oversized tar metadata')
      const body = read(padded(entrySize)).subarray(0, entrySize)
      if (type === 'x') nextPax = parsePax(body)
      else if (type === 'g') globalPax = { ...globalPax, ...parsePax(body) }
      else if (type === 'L') longName = cString(body, 0, body.length)
      continue
    }

    const pax = { ...globalPax, ...nextPax }
    nextPax = {}
    let name = cString(header, 0, 100)
    if (header.subarray(257, 262).toString('latin1') === 'ustar') {
      const prefix = cString(header, 345, 155)
      if (prefix) name = `${prefix}/${name}`
    }
    if (longName !== null) name = longName
    longName = null
    if (typeof pax.path === 'string' && pax.path.length > 0) name = pax.path
    if (typeof pax.size === 'string') {
      if (!/^[0-9]{1,15}$/.test(pax.size)) throw new Fatal('bad pax size')
      entrySize = Number(pax.size)
    }

    const mapped = archiveEntryToPackagePath(name, subdir || undefined)
    if (!mapped.ok) throw new Fatal(`the app would refuse this repository: ${mapped.error}`)
    const path = mapped.value
    const dataBytes = padded(entrySize)

    if (type === '5') {
      read(dataBytes)
      if (path !== null) claimDir(path)
      continue
    }
    if (type !== '0' && type !== '\0' && type !== '7') {
      read(dataBytes)
      if (path !== null) {
        warnings.push(
          type === '1' || type === '2'
            ? `skipped link "${path}" (links are not installed)`
            : `skipped "${path}" (unsupported entry type "${type}")`
        )
      }
      continue
    }
    if (path === null) {
      read(dataBytes)
      continue
    }
    if (files.length + 1 > TAR_LIMITS.files) throw new Fatal(`more than ${TAR_LIMITS.files} files`)
    if (entrySize > TAR_LIMITS.fileBytes) throw new Fatal(`"${path}" is larger than ${TAR_LIMITS.fileBytes} bytes`)
    if (totalBytes + entrySize > TAR_LIMITS.totalBytes) throw new Fatal(`package is larger than ${TAR_LIMITS.totalBytes} bytes`)
    const key = path.toLowerCase()
    if (fileKeys.has(key) || dirKeys.has(key)) throw new Fatal(`duplicate entry "${path}"`)
    const segments = path.split('/')
    for (let i = 1; i < segments.length; i++) claimDir(segments.slice(0, i).join('/'))
    fileKeys.add(key)

    const body = read(dataBytes).subarray(0, entrySize)
    if (destDir) {
      const target = join(destDir, path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, body, { flag: 'wx' })
    }
    totalBytes += entrySize
    files.push({ path, size: entrySize, sha256: createHash('sha256').update(body).digest('hex') })
  }

  const treeHash = createHash('sha256').update(treeHashInput(files), 'utf8').digest('hex')
  return { files, totalBytes, treeHash, warnings }
}

// --- the SDK's CLI -------------------------------------------------------------

const require = createRequire(import.meta.url)
const SDK_DIR = dirname(require.resolve('@neurosquad/card-sdk/package.json'))
const SDK_PACKAGE = JSON.parse(readFileSync(join(SDK_DIR, 'package.json'), 'utf8'))
const SDK_CLI = join(SDK_DIR, SDK_PACKAGE.bin['neurosquad-card'])

function runSdk(args) {
  const run = spawnSync(process.execPath, [SDK_CLI, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 64 * 1024 * 1024
  })
  let json = null
  try {
    json = JSON.parse(run.stdout)
  } catch {
    // not JSON: the CLI failed before printing its report
  }
  return { status: run.status, json, stdout: run.stdout, stderr: run.stderr }
}

// --- helpers --------------------------------------------------------------------

const sorted = (list) => [...list].sort()
const sameList = (a, b) => a.length === b.length && a.every((value, i) => value === b[i])
const isSorted = (list) => sameList(list, sorted(list))
const show = (list) => (list.length ? list.join(', ') : '(none)')

function localizedEn(text) {
  return typeof text === 'string' ? text : text?.en
}

function compareSemver(a, b) {
  const parse = (v) => v.split(/[-+]/)[0].split('.').map(Number)
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

function manifestFacts(manifest) {
  const required = sorted(manifest.permissions.filter((p) => !p.optional).map((p) => p.id))
  const optional = sorted(manifest.permissions.filter((p) => p.optional).map((p) => p.id))
  const hosts = sorted([
    ...new Set(manifest.permissions.filter((p) => p.id === 'network').flatMap((p) => p.hosts ?? []))
  ])
  return { required, optional, hosts }
}

function canonicalEntry(entry) {
  const out = {}
  for (const key of ENTRY_KEYS) if (entry[key] !== undefined) out[key] = entry[key]
  for (const key of Object.keys(entry)) if (!(key in out)) out[key] = entry[key]
  return out
}

function canonicalCatalog(catalog) {
  const out = {}
  for (const key of ['$schema', 'schemaVersion', 'updatedAt', 'cards']) if (catalog[key] !== undefined) out[key] = catalog[key]
  for (const key of Object.keys(catalog)) if (!(key in out)) out[key] = catalog[key]
  out.cards = [...(catalog.cards ?? [])].map(canonicalEntry).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return out
}

function git(args) {
  const run = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  return run.status === 0 ? run.stdout : null
}

// --- the file -------------------------------------------------------------------

function checkFile(text) {
  console.log(bold('verified.json'))
  let catalog
  try {
    catalog = JSON.parse(text)
  } catch (cause) {
    error('', `not valid JSON: ${cause.message}`)
    return null
  }
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  const validate = ajv.compile(JSON.parse(readFileSync(SCHEMA, 'utf8')))
  if (!validate(catalog)) {
    for (const issue of validate.errors) error(issue.instancePath || '/', `${issue.message}${issue.params ? ` ${JSON.stringify(issue.params)}` : ''}`)
    return null
  }
  ok('matches verified.schema.json')

  // The schema's permission list must be the SDK's (catches a new permission in a newer SDK).
  const schemaIds = JSON.parse(readFileSync(SCHEMA, 'utf8')).$defs.permissionId.enum
  if (!sameList(sorted(schemaIds), sorted(PERMISSION_IDS))) {
    error('verified.schema.json', `permission ids differ from @neurosquad/card-sdk ${SDK_PACKAGE.version}: ${show(sorted(PERMISSION_IDS))}`)
  }

  const cards = catalog.cards
  const ids = new Map()
  const sources = new Map()
  const packageIds = new Map()
  for (const card of cards) {
    const where = `cards/${card.id}`
    if (ids.has(card.id)) error(where, 'duplicate id')
    ids.set(card.id, card)
    const source = `${card.repo.toLowerCase()}/${card.path ?? ''}`
    if (sources.has(source)) error(where, `the same package as "${sources.get(source)}" (${card.repo}${card.path ? `/${card.path}` : ''})`)
    sources.set(source, card.id)
    if (packageIds.has(card.packageId)) warning(where, `packageId "${card.packageId}" is also used by "${packageIds.get(card.packageId)}"`)
    packageIds.set(card.packageId, card.id)
    for (const key of ['permissions', 'optionalPermissions', 'networkHosts']) {
      if (card[key] && !isSorted(card[key])) error(where, `${key} must be sorted`)
    }
    const overlap = (card.permissions ?? []).filter((id) => (card.optionalPermissions ?? []).includes(id))
    if (overlap.length) error(where, `listed as both required and optional: ${show(overlap)}`)
    if ((card.networkHosts ?? []).length > 0 && ![...card.permissions, ...(card.optionalPermissions ?? [])].includes('network')) {
      error(where, 'networkHosts without the network permission')
    }
    if (card.verifiedAt > catalog.updatedAt.slice(0, 10)) error(where, `verifiedAt ${card.verifiedAt} is after updatedAt ${catalog.updatedAt}`)
    if (card.official && card.author.github.toLowerCase() !== OFFICIAL_OWNER) error(where, `official cards are authored by ${OFFICIAL_OWNER}`)
  }
  const now = Date.now()
  if (Date.parse(catalog.updatedAt) > now + 24 * 3600 * 1000) error('updatedAt', 'is in the future')
  if (!sameList(cards.map((c) => c.id), sorted(cards.map((c) => c.id)))) error('cards', 'must be sorted by id (run `npm run format`)')
  const canonical = `${JSON.stringify(canonicalCatalog(catalog), null, 2)}\n`
  if (text.replace(/\r\n/g, '\n') !== canonical) {
    error('', 'not in canonical form (2-space JSON, canonical key order, sorted cards, final newline) — run `npm run format`')
  } else {
    ok(`canonical form, ${cards.length} card${cards.length === 1 ? '' : 's'}, unique ids`)
  }
  return catalog
}

// --- one entry --------------------------------------------------------------------

const repoCache = new Map()
async function repoInfo(repo) {
  if (!repoCache.has(repo)) repoCache.set(repo, await github(`/repos/${repo}`))
  return repoCache.get(repo)
}

/** Downloads and inspects one package at one commit; used by checks and `entry`. */
async function inspectRemote(repo, path, commit, workDir) {
  const info = await repoInfo(repo)
  if (info.status === 404 || !info.body) throw new Fatal(`repository ${repo} not found (or private and no token with access)`)
  const archive = await github(`/repos/${repo}/tarball/${commit}`, { accept: 'application/vnd.github+json', raw: true })
  if (!archive.body) throw new Fatal(`could not download ${repo} at ${commit} (HTTP ${archive.status})`)
  if (archive.finalHost && archive.finalHost !== 'codeload.github.com' && archive.finalHost !== 'api.github.com') {
    throw new Fatal(`the archive was served from ${archive.finalHost}, not codeload.github.com`)
  }
  const extracted = readPackageFromTarball(archive.body, path, workDir)
  return { info: info.body, archiveBytes: archive.body.length, ...extracted }
}

async function checkEntry(card, options) {
  const where = `cards/${card.id}`
  const label = `${card.id} ${dim(`(${card.repo}${card.path ? `/${card.path}` : ''} @ ${card.commit.slice(0, 12)})`)}`
  console.log(`\n${bold(label)}`)
  const before = errorCount
  const workDir = mkdtempSync(join(tmpdir(), 'ns-verify-'))
  const pkgDir = join(workDir, 'package')
  try {
    // 1. The repository: exists, not renamed, public, and who owns it.
    const info = await repoInfo(card.repo)
    if (info.status === 404 || !info.body) {
      error(where, `repository ${card.repo} not found (or private and the token has no access)`)
      return
    }
    const repo = info.body
    if (repo.full_name.toLowerCase() !== card.repo.toLowerCase()) {
      error(where, `${card.repo} now answers as ${repo.full_name} (renamed or transferred) — the app refuses the old name`)
    }
    if (repo.private) {
      if (card.repo.toLowerCase() === CATALOG_REPO) warning(where, `${card.repo} is private: users need a GitHub token in the app until it is public`)
      else error(where, `${card.repo} is private — verified cards must come from public repositories`)
    }
    if (repo.archived) warning(where, `${card.repo} is archived`)
    const ownerIsOfficial = repo.owner?.login?.toLowerCase() === OFFICIAL_OWNER && repo.owner?.id === OFFICIAL_OWNER_ID
    if (card.official && !ownerIsOfficial) error(where, `official: true, but ${card.repo} is not owned by ${OFFICIAL_OWNER} (id ${OFFICIAL_OWNER_ID})`)
    if (!card.official && ownerIsOfficial) warning(where, `${card.repo} belongs to ${OFFICIAL_OWNER} but the entry is not official`)
    if (!card.official && card.author.github.toLowerCase() !== repo.owner.login.toLowerCase()) {
      warning(where, `author.github "${card.author.github}" is not the repository owner "${repo.owner.login}" — make sure the author controls it`)
    }

    // 2. The commit: exists and is reachable from the default branch (not a fork's impostor commit).
    const commit = await github(`/repos/${card.repo}/commits/${card.commit}`, { accept: 'application/vnd.github.sha' })
    if (!commit.body || commit.body !== card.commit) {
      error(where, `commit ${card.commit} does not exist in ${card.repo}`)
      return
    }
    const compare = await github(`/repos/${card.repo}/compare/${encodeURIComponent(repo.default_branch)}...${card.commit}`)
    const status = compare.body?.status
    if (status === 'identical' || status === 'behind') ok(`commit is on the default branch (${repo.default_branch}: ${status})`)
    else error(where, `commit ${card.commit.slice(0, 12)} is not reachable from ${repo.default_branch} (compare: ${status ?? `HTTP ${compare.status}`})`)

    // 3. The package at that commit, read exactly as the app reads it.
    let extracted
    try {
      extracted = await inspectRemote(card.repo, card.path, card.commit, pkgDir)
    } catch (cause) {
      if (cause instanceof Fatal) {
        error(where, cause.message)
        return
      }
      throw cause
    }
    for (const message of extracted.warnings) warning(where, message)
    if (extracted.files.length === 0) {
      error(where, `no files under "${card.path ?? '/'}" at ${card.commit.slice(0, 12)}`)
      return
    }
    if (extracted.treeHash === card.treeHash) ok(`tree hash ${extracted.treeHash} (${extracted.files.length} files, ${extracted.totalBytes} bytes)`)
    else error(where, `treeHash is ${extracted.treeHash} at this commit, the entry says ${card.treeHash}`)

    // 4. The manifest, through the app's own parser.
    const manifestFile = extracted.files.find((file) => file.path === MANIFEST_FILE)
    if (!manifestFile) {
      error(where, `${MANIFEST_FILE} is missing at the package root`)
      return
    }
    const parsed = parseManifestText(readFileSync(join(pkgDir, MANIFEST_FILE), 'utf8'))
    if (!parsed.ok) {
      for (const issue of parsed.issues) error(where, `manifest ${issue.path || '/'}: ${issue.message}`)
      return
    }
    const manifest = parsed.manifest
    if (manifest.name !== card.packageId) error(where, `packageId is "${card.packageId}", the manifest's name is "${manifest.name}"`)
    if (manifest.version !== card.version) error(where, `version is ${card.version}, the manifest says ${manifest.version}`)
    const facts = manifestFacts(manifest)
    if (!sameList(facts.required, sorted(card.permissions))) error(where, `permissions: the manifest requires ${show(facts.required)}, the entry says ${show(card.permissions)}`)
    if (!sameList(facts.optional, sorted(card.optionalPermissions ?? []))) error(where, `optionalPermissions: the manifest declares ${show(facts.optional)}, the entry says ${show(card.optionalPermissions ?? [])}`)
    if (!sameList(facts.hosts, sorted(card.networkHosts ?? []))) error(where, `networkHosts: the manifest declares ${show(facts.hosts)}, the entry says ${show(card.networkHosts ?? [])}`)
    if (errorCount === before) ok(`manifest ${manifest.name} ${manifest.version}; permissions ${show(facts.required)}; optional ${show(facts.optional)}${facts.hosts.length ? `; hosts ${show(facts.hosts)}` : ''}`)
    if (manifest.license && manifest.license !== card.license) error(where, `license is "${card.license}", the manifest says "${manifest.license}"`)
    if (!manifest.license) warning(where, 'the manifest declares no license')
    if (!extracted.files.some((file) => /^(licen[cs]e|copying)(\.[a-z]+)?$/i.test(file.path))) warning(where, 'no LICENSE file in the package folder')
    if (manifest.minAppVersion && (!card.minAppVersion || compareSemver(card.minAppVersion, manifest.minAppVersion) < 0)) {
      error(where, `minAppVersion must be at least the manifest's ${manifest.minAppVersion}`)
    }
    const names = new Set(extracted.files.map((file) => file.path))
    if (card.icon && !names.has(card.icon)) error(where, `icon "${card.icon}" is not in the package`)
    if (card.icon && manifest.icon && card.icon !== manifest.icon) warning(where, `icon "${card.icon}" differs from the manifest's "${manifest.icon}"`)
    for (const shot of card.screenshots ?? []) if (!names.has(shot)) error(where, `screenshot "${shot}" is not in the package`)
    if (localizedEn(card.name) !== localizedEn(manifest.displayName)) warning(where, `name.en "${localizedEn(card.name)}" differs from the manifest's displayName "${localizedEn(manifest.displayName)}"`)
    if (!card.official) {
      for (const issue of impersonationIssues(manifest)) error(where, `manifest ${issue.path}: ${issue.message} (the app refuses it)`)
      if (/neurosquad|official|verified/.test(card.author.name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))) {
        error(where, 'author.name may not say NeuroSquad, official or verified')
      }
    }

    // 5. The SDK's validate — the same validators the app runs, plus entry page and icon checks.
    const validation = runSdk(['validate', pkgDir, '--json'])
    if (!validation.json) error(where, `neurosquad-card validate failed: ${(validation.stderr || validation.stdout).trim().slice(0, 500)}`)
    else {
      for (const issue of validation.json.errors ?? []) error(where, `validate ${issue.where}: ${issue.message}`)
      for (const issue of validation.json.warnings ?? []) {
        const impersonation = /only official cards may call themselves/.test(issue.message)
        if (impersonation && card.official) continue
        if (!impersonation) warning(where, `validate ${issue.where}: ${issue.message}`)
      }
      if (validation.json.ok && (validation.json.errors ?? []).length === 0) ok(`neurosquad-card validate (SDK ${SDK_PACKAGE.version})`)
    }

    // 6. Cross-check: the SDK's pack on the extracted folder prints the same tree hash.
    const pack = runSdk(['pack', pkgDir, '--dry-run', '--json'])
    if (!pack.json?.treeHash) {
      error(where, `neurosquad-card pack refused the package: ${(pack.stderr || pack.stdout).trim().split('\n').pop()?.slice(0, 500)}`)
    } else if (pack.json.treeHash !== extracted.treeHash) {
      error(where, `neurosquad-card pack computes ${pack.json.treeHash} for the same files (the package contains files pack skips, e.g. node_modules/ or .git)`)
    } else {
      ok('neurosquad-card pack --dry-run prints the same tree hash')
    }
    if (options.verbose) for (const file of extracted.files) console.log(dim(`      ${file.sha256}  ${file.path}`))
  } finally {
    rmSync(workDir, { recursive: true, force: true })
    if (errorCount === before) console.log(green(`  → ${card.id} verified`))
  }
}

// --- `entry` --------------------------------------------------------------------

async function draftEntry(sourceArg, commitArg) {
  const match = /^(?:https:\/\/github\.com\/)?([^/\s]+)\/([^/\s@]+?)(?:\.git)?(?:\/([^@\s]+))?(?:@([0-9a-f]{40}))?$/.exec(sourceArg ?? '')
  if (!match) throw new Fatal('usage: node scripts/verify.mjs entry <owner>/<repo>[/<path>] [--commit <40-hex sha>]')
  const [, owner, name, subdir, atCommit] = match
  const info = await repoInfo(`${owner}/${name}`)
  if (!info.body) throw new Fatal(`repository ${owner}/${name} not found`)
  const repo = info.body.full_name
  let commit = commitArg ?? atCommit
  if (!commit) {
    const head = await github(`/repos/${repo}/commits/${encodeURIComponent(info.body.default_branch)}`, { accept: 'application/vnd.github.sha' })
    commit = head.body
  }
  const workDir = mkdtempSync(join(tmpdir(), 'ns-verify-'))
  try {
    const pkgDir = join(workDir, 'package')
    const extracted = await inspectRemote(repo, subdir, commit, pkgDir)
    const parsed = parseManifestText(readFileSync(join(pkgDir, MANIFEST_FILE), 'utf8'))
    if (!parsed.ok) throw new Fatal(`the manifest is invalid: ${parsed.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`)
    const manifest = parsed.manifest
    const facts = manifestFacts(manifest)
    const localized = (text) => (typeof text === 'string' ? { en: text } : { ...text })
    const official = info.body.owner.login.toLowerCase() === OFFICIAL_OWNER && info.body.owner.id === OFFICIAL_OWNER_ID
    const entry = canonicalEntry({
      id: manifest.name,
      packageId: manifest.name,
      name: localized(manifest.displayName),
      description: localized(manifest.description ?? manifest.displayName),
      author: { name: manifest.author?.name ?? info.body.owner.login, github: info.body.owner.login },
      repo,
      path: subdir,
      version: manifest.version,
      commit,
      treeHash: extracted.treeHash,
      permissions: facts.required,
      optionalPermissions: facts.optional,
      networkHosts: facts.hosts.length ? facts.hosts : undefined,
      tags: (manifest.keywords ?? []).map((k) => k.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')).filter(Boolean).slice(0, 10),
      category: 'other',
      license: manifest.license ?? 'UNLICENSED',
      homepage: manifest.homepage ?? `https://github.com/${repo}${subdir ? `/tree/${info.body.default_branch}/${subdir}` : ''}`,
      icon: manifest.icon,
      minAppVersion: manifest.minAppVersion,
      official,
      verifiedAt: new Date().toISOString().slice(0, 10),
      reviewer: 'glmn-ai'
    })
    console.log(JSON.stringify(entry, null, 2))
    console.error(dim(`\n${extracted.files.length} files, ${extracted.totalBytes} bytes. Review category, tags, screenshots and description before submitting.`))
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

// --- main -----------------------------------------------------------------------

function parseArgs(argv) {
  const options = { ids: [], changedOnly: null, offline: false, verbose: false, commit: null, positional: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--changed-only') options.changedOnly = argv[++i]
    else if (arg === '--id') options.ids.push(argv[++i])
    else if (arg === '--offline') options.offline = true
    else if (arg === '--verbose' || arg === '-v') options.verbose = true
    else if (arg === '--commit') options.commit = argv[++i]
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg.startsWith('--')) throw new Fatal(`unknown option ${arg}`)
    else options.positional.push(arg)
  }
  if (options.changedOnly === undefined) throw new Fatal('--changed-only needs a git ref (e.g. origin/main or base..head)')
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const [command, ...rest] = options.positional
  if (options.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
    return 0
  }
  if (command === 'entry') {
    await draftEntry(rest[0], options.commit)
    return 0
  }
  if (command === 'format') {
    const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'))
    writeFileSync(CATALOG, `${JSON.stringify(canonicalCatalog(catalog), null, 2)}\n`)
    console.log('verified.json rewritten in canonical form')
    return 0
  }
  if (command) throw new Fatal(`unknown command "${command}"`)

  const catalog = checkFile(readFileSync(CATALOG, 'utf8'))
  if (!catalog) return summary()

  let selected = catalog.cards
  if (options.ids.length) {
    for (const id of options.ids) if (!catalog.cards.some((card) => card.id === id)) error('', `no entry with id "${id}"`)
    selected = catalog.cards.filter((card) => options.ids.includes(card.id))
  }
  if (options.changedOnly) {
    const base = options.changedOnly.includes('..') ? options.changedOnly.split('..')[0] : options.changedOnly
    const baseText = git(['show', `${base}:verified.json`])
    let baseCards = []
    if (baseText === null) console.log(dim(`\n(verified.json does not exist at ${base}: every entry is new)`))
    else {
      try {
        baseCards = JSON.parse(baseText).cards ?? []
      } catch {
        baseCards = []
      }
    }
    const previous = new Map(baseCards.map((card) => [card.id, JSON.stringify(canonicalEntry(card))]))
    selected = selected.filter((card) => previous.get(card.id) !== JSON.stringify(canonicalEntry(card)))
    const removed = baseCards.filter((card) => !catalog.cards.some((c) => c.id === card.id)).map((card) => card.id)
    console.log(`\nChanged since ${base}: ${selected.length ? selected.map((c) => c.id).join(', ') : '(no entries)'}${removed.length ? `; removed: ${removed.join(', ')}` : ''}`)
  }
  if (options.offline) {
    console.log(dim(`\n--offline: skipped the package checks of ${selected.length} entr${selected.length === 1 ? 'y' : 'ies'}`))
    return summary()
  }
  if (!githubToken()) console.log(yellow('\nNo GitHub token (GITHUB_TOKEN / GH_TOKEN / gh auth): unauthenticated API limits apply.'))
  for (const card of selected) {
    try {
      await checkEntry(card, options)
    } catch (cause) {
      if (cause instanceof Fatal) error(`cards/${card.id}`, cause.message)
      else throw cause
    }
  }
  return summary()
}

function summary() {
  console.log('')
  if (errorCount > 0) {
    console.log(red(bold(`✖ ${errorCount} error${errorCount === 1 ? '' : 's'}`)) + (warningCount ? yellow(`, ${warningCount} warning${warningCount === 1 ? '' : 's'}`) : ''))
    return 1
  }
  console.log(green(bold('✔ verified.json is valid')) + (warningCount ? yellow(` (${warningCount} warning${warningCount === 1 ? '' : 's'})`) : ''))
  return 0
}

main().then(
  (code) => process.exit(code),
  (cause) => {
    if (cause instanceof Fatal) {
      console.error(red(`✖ ${cause.message}`))
      process.exit(1)
    }
    console.error(cause)
    process.exit(2)
  }
)
