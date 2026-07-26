import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).split('\0').filter(Boolean)

const credentialPatterns = [
  { name: 'provider API key', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Resend API key', regex: /\bre_[A-Za-z0-9_-]{20,}\b/g },
  { name: 'GitHub token', regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  {
    name: 'quoted assigned secret',
    regex: /\b(?:API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*(["'])([^\n"']{16,})\1/gi,
    allow: /^(?:replace-|example|test|dummy|placeholder|your-)/i,
  },
  {
    name: 'unquoted assigned secret',
    regex: /\b(?:API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*([A-Za-z0-9_./+=-]{24,})/gi,
    allow: /^(?:replace-|example|test|dummy|placeholder|your-)/i,
  },
]

const findings = []
for (const relativePath of trackedFiles) {
  const bytes = readFileSync(resolve(repoRoot, relativePath))
  if (bytes.includes(0)) continue
  const source = bytes.toString('utf8')
  for (const pattern of credentialPatterns) {
    pattern.regex.lastIndex = 0
    for (const match of source.matchAll(pattern.regex)) {
      const candidate = match[match.length - 1] ?? match[0]
      if (pattern.allow?.test(candidate)) continue
      const line = source.slice(0, match.index).split('\n').length
      findings.push({ path: relativePath, line, kind: pattern.name })
    }
  }
}

if (findings.length > 0) {
  console.error('Credential scan failed. Potential secrets were found in tracked files:')
  for (const finding of findings) console.error(`- ${finding.path}:${finding.line} (${finding.kind})`)
  process.exitCode = 1
} else {
  console.log(`Credential scan passed (${trackedFiles.length} tracked files; ignored .env files were not read).`)
}
