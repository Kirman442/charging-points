const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
function check(ref) {
  if (/^0+$/.test(ref)) return;
  const names = execFileSync('git', ['ls-tree', '-r', '--name-only', ref], { encoding: 'utf8' }).trim().split('\n');
  const bad = names.filter(name => /^README_.+\.(md|txt)$/i.test(name) || /^[^/]*handoff[^/]*\.(md|txt)$/i.test(name) || /^(?:\.review)\//.test(name) || /^\.env(?:\..+)?$/.test(name));
  if (bad.length) throw new Error(`Internal documents/configuration found in ${ref}:\n${bad.join('\n')}\nKeep local notes outside the public repository.`);
}
try {
  if (process.argv[2] === '--pre-push') {
    for (const line of readFileSync(0, 'utf8').trim().split('\n').filter(Boolean)) check(line.trim().split(/\s+/)[1]);
  } else check(process.argv[2] || 'HEAD');
} catch (error) { console.error(error.message); process.exitCode = 1; }
