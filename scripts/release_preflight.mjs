import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { runtimeAssets } from './runtimeAssets.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const roots = new Set(['.gitignore','README.md','eslint.config.js','index.html','datenschutz.html','impressum.html','package.json','package-lock.json','vite.config.js'])
const publicPaths = new Set([...runtimeAssets.map(n=>`public/${n}`), ...['charging_points_zstd10.parquet','charging_sites_zstd10.parquet','charging_sites_browser_zstd10.parquet','charging_point_groups_zstd10.parquet'].map(n=>`public/data/${n}`)])
const trackedFiles = execFileSync('git', ['ls-files','-z'], {cwd:root}).toString().split('\0').filter(Boolean)
const files = execFileSync('git', ['ls-files','--cached','--others','--exclude-standard','-z'], {cwd:root}).toString().split('\0').filter(Boolean)
const extra = files.filter(n=>!roots.has(n) && n!=='.github/workflows/deploy.yml' && !n.startsWith('src/') && !(n.startsWith('tests/') && /\.(mjs|json|parquet)$/.test(n)) && !['scripts/runtimeAssets.mjs','scripts/release_preflight.mjs','scripts/languageAccess.mjs'].includes(n) && !publicPaths.has(n))
if (extra.length) throw new Error(`Non-release files tracked: ${extra.join(', ')}`)
const readme = execFileSync('git',['show',':README.md'],{cwd:root}).toString()
if (/README_\d|# Step\d|M:\\projekte|Electromobility-handoff/.test(readme)) throw new Error('Internal development journal staged as public README')
const walk = dir => readdirSync(dir).flatMap(n=>statSync(join(dir,n)).isDirectory()?walk(join(dir,n)).map(p=>`${n}/${p}`):[n])
const dist = join(root,'dist'), built = walk(dist), expected = new Set(['index.html','datenschutz.html','impressum.html',...runtimeAssets])
for (const name of expected) if (!existsSync(join(dist,name))) throw new Error(`Missing runtime asset: ${name}`)
for (const name of built) if (!expected.has(name) && !/^assets\/[^/]+\.(js|css|wasm|woff2|svg|png)$/.test(name)) throw new Error(`Unexpected deployed file: ${name}`)
for (const name of runtimeAssets) if (!readFileSync(join(dist,name)).equals(readFileSync(join(root,'public',name)))) throw new Error(`Runtime asset changed: ${name}`)
const language = JSON.parse(readFileSync(join(root, '.review/build-language.json'), 'utf8'))
if (!language.germanOnly || !/^[a-f0-9]{64}$/.test(language.reviewHash)) throw new Error('Missing publication language configuration')
const clientText = built.filter(name => /\.(js|html|css|json)$/.test(name)).map(name => readFileSync(join(dist, name), 'utf8')).join('\n')
if (/\[Charging (render|input|controller|timing|performance|stall)\]/.test(clientText)) throw new Error('Development diagnostics included in publication build')
if (clientText.includes('__storage_test__')) throw new Error('Automatic library storage probes included in publication build')
if (!clientText.includes(language.reviewHash)) throw new Error('Review hash missing from publication build')
const accessFile = join(root, '.review/review-access.json')
if (existsSync(accessFile) && clientText.includes(JSON.parse(readFileSync(accessFile, 'utf8')).key)) throw new Error('Local review key included in publication build')
const hashes=Object.fromEntries(runtimeAssets.map(n=>[n,createHash('sha256').update(readFileSync(join(dist,n))).digest('hex')]))
console.log(JSON.stringify({tracked_files:trackedFiles.length, source_files:files.length, runtime_assets:runtimeAssets.length, built_files:built.length, extra_files:[],language:'de',review_access:'SHA-256 only; not authentication',runtime_asset_hashes:hashes},null,2))
