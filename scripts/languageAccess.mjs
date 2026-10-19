import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const root = fileURLToPath(new URL('../', import.meta.url))
const hashKey = key => createHash('sha256').update(key).digest('hex')

export function prepareReviewAccess(directory = root, env = process.env) {
  const local = join(directory, '.review'), accessFile = join(local, 'review-access.json')
  let key = env.CHARGING_REVIEW_KEY || '', hash = env.CHARGING_REVIEW_HASH || ''
  if (hash && !/^[a-f0-9]{64}$/.test(hash)) throw new Error('CHARGING_REVIEW_HASH must be a lowercase SHA-256 hash')
  if (!key && !hash) {
    if (env.CI) throw new Error('Set CHARGING_REVIEW_KEY or CHARGING_REVIEW_HASH in CI before publishing')
    key = existsSync(accessFile) ? JSON.parse(readFileSync(accessFile, 'utf8')).key : randomBytes(24).toString('hex')
  }
  if (key) {
    if (!/^[A-Za-z0-9_-]{24,128}$/.test(key)) throw new Error('CHARGING_REVIEW_KEY must contain 24-128 URL-safe characters')
    const actual = hashKey(key)
    if (hash && hash !== actual) throw new Error('CHARGING_REVIEW_KEY does not match CHARGING_REVIEW_HASH')
    hash = actual
  }
  if (!hash) throw new Error('No valid review key or hash configured')
  mkdirSync(local, { recursive: true })
  if (key) {
    writeFileSync(accessFile, JSON.stringify({ key, sha256: hash }, null, 2) + '\n', { mode: 0o600 })
    writeFileSync(join(local, 'README-review-access.md'), `# Редакторская проверка RU/DE\n\nЛокальный preview: http://127.0.0.1:4175/charging-points/?review=${key}\n\nПосле отдельной публикации с тем же хешем: https://kirman442.github.io/charging-points/?review=${key}\n\nБез review либо с неверным ключом сборка открывается на DE без переключателя, независимо от сохранённого языка. Удаление параметра и перезагрузка возвращают этот режим. В dev доступны оба языка.\n\nПеред публикацией задайте GitHub Actions variable CHARGING_REVIEW_HASH (sha256 из review-access.json) либо secret CHARGING_REVIEW_KEY (key из того же файла). В CI без этих настроек сборка останавливается: случайный недоступный редактору ключ не создаётся. Не задавайте переменные с префиксом VITE_ для исходного ключа.\n\nЭто скрытый режим проверки, не авторизация: оба перевода остаются в клиентском коде. Не включать эту папку в Git, proof или reviewable ZIP.\n`)
  }
  writeFileSync(join(local, 'build-language.json'), JSON.stringify({ germanOnly: true, reviewHash: hash }, null, 2) + '\n')
  return hash
}

export function languageAccessDefines(command) {
  return {
    'import.meta.env.VITE_CHARGING_GERMAN_ONLY': JSON.stringify(command === 'build' ? '1' : '0'),
    'import.meta.env.VITE_CHARGING_REVIEW_HASH': JSON.stringify(command === 'build' ? prepareReviewAccess() : ''),
  }
}
