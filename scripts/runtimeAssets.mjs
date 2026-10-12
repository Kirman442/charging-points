import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, lstatSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { FILES } from '../src/config/map.js'
import { AUTOBAHNS } from '../src/data/autobahn.js'

export const runtimeAssets = [...new Set([
  'favicon.svg', 'data/README_charging_tables_zstd10.txt', 'data/README_emob_boundaries_string.txt',
  ...Object.values(FILES).map(name => `data/${name}`),
  ...Object.entries(AUTOBAHNS).flatMap(([route, info]) => info.tables
    ? info.tables.map(kind => `data/autobahn_${route.toLowerCase()}_${kind}_zstd10.parquet`)
    : [`data/autobahn_${route.toLowerCase()}_zstd10.parquet`]),
])].sort()

export function runtimeAssetsPlugin() {
  const root = fileURLToPath(new URL('../', import.meta.url)), tempRoot = realpathSync(tmpdir())
  let stagedPublic
  return {
    name: 'charging-runtime-assets', apply: 'build',
    config() {
      stagedPublic = mkdtempSync(join(tempRoot, 'charging-release-public-'))
      for (const name of runtimeAssets) {
        const target = join(stagedPublic, name)
        mkdirSync(dirname(target), { recursive: true })
        copyFileSync(join(root, 'public', name), target)
      }
      return { publicDir: stagedPublic }
    },
    closeBundle() {
      if (stagedPublic && dirname(stagedPublic) === tempRoot && basename(stagedPublic).startsWith('charging-release-public-') && !lstatSync(stagedPublic).isSymbolicLink()) rmSync(stagedPublic, { recursive: true, force: true })
    },
  }
}
