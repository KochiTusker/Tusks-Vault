#!/usr/bin/env node
/**
 * Shipping-dependency vulnerability gate, with named exceptions.
 *
 * `npm audit --omit=dev --audit-level=high` is the right scope — dependencies
 * that actually reach an install, at a severity worth blocking on — but it is
 * a binary. When an advisory lands with no fix available, the only ways to get
 * CI green again are to weaken the level or append `|| true`, and both of those
 * disarm the gate permanently for every FUTURE advisory too. A gate everyone
 * has learned to ignore is worse than no gate, because it still looks like one.
 *
 * So: the same scan, and anything not listed below still fails the build. Each
 * exception has to say which advisory, why it is survivable HERE, and when it
 * was last looked at. An exception is a decision with a date on it, not a
 * silence.
 *
 *   node scripts/audit-dependencies.mjs
 *   node scripts/audit-dependencies.mjs --level moderate
 */
import { spawnSync } from 'node:child_process'

/**
 * Advisories accepted for now.
 *
 * Both current entries are transitive through `@huggingface/transformers`,
 * which is the local embedding engine — a genuine runtime dependency, not
 * tooling. Neither has a fixed release inside the range its parent allows, so
 * the only "fix" available today is to fork or pin a parent that does not yet
 * exist.
 */
const ACCEPTED = [
  {
    id: 'GHSA-f88m-g3jw-g9cj',
    package: 'sharp',
    reviewed: '2026-09-07',
    why:
      'libvips CVEs reachable only by decoding an attacker-supplied image. Nothing ' +
      'in this app invokes sharp: it arrives under @huggingface/transformers, whose ' +
      'range is ^0.34.5 while the fix is 0.35.0. Vault never decodes user images — ' +
      'uploads are documents, and the one image path is a build-time script that is ' +
      'dev-only and reads a file the maintainer supplies.',
  },
  {
    id: 'GHSA-xcpc-8h2w-3j85',
    package: 'adm-zip',
    reviewed: '2026-09-07',
    why:
      'A crafted ZIP can force a 4 GB allocation. Reached via onnxruntime-node, ' +
      'which unpacks the embedding model archive fetched over HTTPS from ' +
      'huggingface.co on first boot. The only ZIP it opens is that one; no ' +
      'user-supplied archive reaches it.',
  },
]

const LEVELS = ['info', 'low', 'moderate', 'high', 'critical']
const levelArg = process.argv.indexOf('--level')
const MIN_LEVEL = levelArg !== -1 ? process.argv[levelArg + 1] : 'high'
const minIndex = LEVELS.indexOf(MIN_LEVEL)
if (minIndex === -1) {
  console.error(`Unknown --level "${MIN_LEVEL}". One of: ${LEVELS.join(', ')}`)
  process.exit(2)
}

// --json always exits 0 on findings, so the exit code carries no information
// here and the report is parsed instead.
const proc = spawnSync(
  'npm',
  ['audit', '--omit=dev', '--json'],
  { encoding: 'utf8', shell: process.platform === 'win32' },
)

let report
try {
  report = JSON.parse(proc.stdout)
} catch {
  console.error('Could not parse `npm audit --json` output:')
  console.error(proc.stdout?.slice(0, 500) || proc.stderr?.slice(0, 500) || '(no output)')
  process.exit(2)
}

const acceptedIds = new Set(ACCEPTED.map((a) => a.id))
const blocking = []
const waived = []

for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  if (LEVELS.indexOf(vuln.severity) < minIndex) continue
  // `via` mixes advisory objects with plain strings naming another package
  // that pulls this one in; only the objects carry an advisory URL.
  const advisories = (vuln.via ?? []).filter((v) => typeof v === 'object')
  // A package can be flagged purely because a dependency of it is, in which
  // case the advisory (and its exception) lives on that dependency.
  if (advisories.length === 0) continue

  for (const a of advisories) {
    const ghsa = (a.url ?? '').split('/').pop() ?? ''
    const row = { package: name, title: a.title, severity: a.severity ?? vuln.severity, id: ghsa }
    if (acceptedIds.has(ghsa)) waived.push(row)
    else blocking.push(row)
  }
}

if (waived.length > 0) {
  console.log(`Accepted advisories (${waived.length}) — see ACCEPTED in ${'scripts/audit-dependencies.mjs'}:`)
  for (const w of waived) {
    const note = ACCEPTED.find((a) => a.id === w.id)
    console.log(`  · ${w.package} ${w.id} [${w.severity}] reviewed ${note?.reviewed}`)
  }
  console.log('')
}

// An exception for something npm no longer reports is stale, and a stale
// exception is how a real advisory gets silently waived later under a
// recycled id. Warn rather than fail: a dependency legitimately disappears.
const stillReported = new Set(waived.map((w) => w.id))
const stale = ACCEPTED.filter((a) => !stillReported.has(a.id))
if (stale.length > 0) {
  console.log('Exceptions no longer reported by npm audit — remove them:')
  for (const s of stale) console.log(`  · ${s.package} ${s.id} (added ${s.reviewed})`)
  console.log('')
}

if (blocking.length === 0) {
  console.log(`✓ No unaccepted ${MIN_LEVEL}+ advisories in shipping dependencies.`)
  process.exit(0)
}

console.error(`✖ ${blocking.length} unaccepted ${MIN_LEVEL}+ advisor(y/ies) in shipping dependencies:\n`)
for (const b of blocking) {
  console.error(`  ${b.package}  [${b.severity}]  ${b.id}`)
  console.error(`    ${b.title}`)
}
console.error('')
console.error('Fix it, or — if it is genuinely not exploitable in this app — add an')
console.error('entry to ACCEPTED in scripts/audit-dependencies.mjs saying why, with')
console.error('the date you checked. Do not weaken the gate.')
process.exit(1)
