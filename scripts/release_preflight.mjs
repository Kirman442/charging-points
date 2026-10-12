import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { runtimeAssets } from './runtimeAssets.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const roots = new Set(['.gitignore','README.md','eslint.config.js','index.html','package.json','package-lock.json','vite.config.js'])
const publicPaths = new Set([...runtimeAssets.map(n=>`public/${n}`), ...['charging_points_zstd10.parquet','charging_sites_zstd10.parquet','charging_sites_browser_zstd10.parquet','charging_point_groups_zstd10.parquet'].map(n=>`public/data/${n}`)])
const files = execFileSync('git', ['ls-files','-z'], {cwd:root}).toString().split('\0').filter(Boolean)
const extra = files.filter(n=>!roots.has(n) && n!=='.github/workflows/deploy.yml' && !n.startsWith('src/') && !(n.startsWith('tests/') && /\.(mjs|json|parquet)$/.test(n)) && !['scripts/runtimeAssets.mjs','scripts/release_preflight.mjs'].includes(n) && !publicPaths.has(n))
if (extra.length) throw new Error(`Non-release files tracked: ${extra.join(', ')}`)
const readme = execFileSync('git',['show',':README.md'],{cwd:root}).toString()
if (/README_\d|# Step\d|M:\\projekte|Electromobility-handoff/.test(readme)) throw new Error('Internal development journal staged as public README')
const walk = dir => readdirSync(dir).flatMap(n=>statSync(join(dir,n)).isDirectory()?walk(join(dir,n)).map(p=>`${n}/${p}`):[n])
const dist = join(root,'dist'), built = walk(dist), expected = new Set(['index.html',...runtimeAssets])
for (const name of expected) if (!existsSync(join(dist,name))) throw new Error(`Missing runtime asset: ${name}`)
for (const name of built) if (!expected.has(name) && !/^assets\/[^/]+\.(js|css|wasm|woff2|svg|png)$/.test(name)) throw new Error(`Unexpected deployed file: ${name}`)
for (const name of runtimeAssets) if (!readFileSync(join(dist,name)).equals(readFileSync(join(root,'public',name)))) throw new Error(`Runtime asset changed: ${name}`)
const hashes=Object.fromEntries(runtimeAssets.map(n=>[n,createHash('sha256').update(readFileSync(join(dist,n))).digest('hex')]))
console.log(JSON.stringify({tracked_files:files.length, runtime_assets:runtimeAssets.length, built_files:built.length, extra_files:[],runtime_asset_hashes:hashes},null,2))
