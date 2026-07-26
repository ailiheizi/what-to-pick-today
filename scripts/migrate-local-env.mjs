import { chmodSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIRED_KEYS = ['AI_PROXY_BASE_URL', 'AI_PROXY_API_KEY', 'RESEND_API_KEY']

function unquote(value) {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function standardAssignments(source) {
  const assignments = new Map()
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (match) assignments.set(match[1], unquote(match[2]))
  }
  return assignments
}

function normalizeApiBase(candidate) {
  const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`
  const url = new URL(withProtocol)
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error('无法识别旧格式中的 API 地址')
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/v1'
  return url.toString().replace(/\/$/, '')
}

export function migrateLocalEnvContent(source) {
  const assignments = standardAssignments(source)
  if (REQUIRED_KEYS.every((key) => assignments.get(key)?.trim())) {
    return { changed: false, content: source, configuredKeys: REQUIRED_KEYS }
  }

  const resend = assignments.get('RESEND_API_KEY')
    || source.match(/resend\s*token\s*:\s*(re_[A-Za-z0-9_-]{16,})/i)?.[1]
  const apiKey = assignments.get('AI_PROXY_API_KEY')
    || source.match(/(?:^|\n)\s*(sk-[A-Za-z0-9_-]{16,})\s*(?:\n|$)/i)?.[1]
  const endpointLine = source.split(/\r?\n/).find((line) => {
    const value = line.trim()
    if (!value || value.includes(':') && !/^https?:\/\//i.test(value)) return false
    try {
      const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`
      return Boolean(new URL(normalized).hostname)
    } catch {
      return false
    }
  })
  const apiBase = assignments.get('AI_PROXY_BASE_URL') || (endpointLine ? normalizeApiBase(endpointLine.trim()) : '')

  const resolved = {
    AI_PROXY_BASE_URL: apiBase,
    AI_PROXY_API_KEY: apiKey ?? '',
    RESEND_API_KEY: resend ?? '',
  }
  const missing = REQUIRED_KEYS.filter((key) => !resolved[key]?.trim())
  if (missing.length) throw new Error(`旧格式识别不完整，未修改 .env；缺少：${missing.join(', ')}`)

  const preserved = source.split(/\r?\n/).filter((line) => {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)
    return Boolean(match && !REQUIRED_KEYS.includes(match[1]))
  })
  const content = [
    '# Local-only credentials. Never commit this file.',
    ...REQUIRED_KEYS.map((key) => `${key}=${resolved[key]}`),
    ...preserved,
    '',
  ].join('\n')
  return { changed: true, content, configuredKeys: REQUIRED_KEYS }
}

export function migrateLocalEnvFile(envPath, { checkOnly = false } = {}) {
  const source = readFileSync(envPath, 'utf8')
  const result = migrateLocalEnvContent(source)
  if (!result.changed || checkOnly) return result

  const temporaryPath = `${envPath}.migrating-${process.pid}`
  try {
    writeFileSync(temporaryPath, result.content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    renameSync(temporaryPath, envPath)
    chmodSync(envPath, 0o600)
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }
  return result
}

const scriptPath = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const repoRoot = resolve(dirname(scriptPath), '..')
  const checkOnly = process.argv.includes('--check')
  const result = migrateLocalEnvFile(resolve(repoRoot, '.env'), { checkOnly })
  const action = result.changed ? (checkOnly ? 'Migration available' : 'Migrated') : 'Already configured'
  console.log(`${action}: ${result.configuredKeys.join(', ')} (values were not printed).`)
}
