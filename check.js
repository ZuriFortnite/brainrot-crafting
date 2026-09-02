/* Verify every asset the game references actually exists.
 *
 * Written after a cleanup deleted seven icons that were still in use. Every
 * local test passed because the browser had them cached; the bug only appeared
 * on a device visiting for the first time - which, for a game nobody has played
 * yet, is every single player.
 *
 * Run before pushing:  node check.js
 */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const problems = [];
const seen = new Set();

function refsIn(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const out = new Set();
  // static paths in markup and in single-quoted JS strings
  for (const m of text.matchAll(/["'(]\s*(assets\/[A-Za-z0-9_\-./]+\.[a-z0-9]{2,5})/g)) {
    out.add(m[1]);
  }
  /* Concatenated paths - 'assets/icon/' + name + '.png' - cannot be resolved by
     reading the source, so the folder is checked against the data file instead
     (see below). Catching the literal prefixes here would only produce noise. */
  return out;
}

for (const f of ['index.html', 'src/plot.js']) {
  for (const r of refsIn(f)) {
    if (seen.has(r)) continue;
    seen.add(r);
    if (!fs.existsSync(path.join(root, r))) problems.push(`${r}  <- ${f}`);
  }
}

// paths the data builds at runtime: icons by name, characters by set and tier
const d = JSON.parse(fs.readFileSync(path.join(root, 'assets/craft.json'), 'utf8'));
const dyn = new Set();
for (const it of d.items) {
  if (it.icon) dyn.add(it.icon);
  if (it.kind === 'br') dyn.add(it.art);   // tier no longer names the file
}
for (const u of d.upgrades) dyn.add(`assets/icon/${u.icon}.png`);
for (const t of d.tasks) dyn.add(`assets/icon/${t.icon}.png`);
for (const r of dyn) {
  if (!fs.existsSync(path.join(root, r))) problems.push(`${r}  <- craft.json`);
}

// icon names assembled in code, which the regex above cannot see
for (const m of fs.readFileSync(path.join(root, 'src/plot.js'), 'utf8')
                 .matchAll(/assets\/icon\/([a-zA-Z0-9_-]+)\.png/g)) {
  const r = `assets/icon/${m[1]}.png`;
  if (!fs.existsSync(path.join(root, r))) problems.push(`${r}  <- plot.js`);
}

const total = seen.size + dyn.size;
if (problems.length) {
  console.error(`FAIL - ${problems.length} missing of ${total} referenced:`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

let bytes = 0, files = 0;
(function walk(dir) {
  for (const n of fs.readdirSync(dir)) {
    if (n === '.git' || n === 'node_modules') continue;
    const p = path.join(dir, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else { bytes += st.size; files++; }
  }
})(root);

console.log(`OK - ${total} references all resolve`);
console.log(`     ${files} files, ${(bytes / 1048576).toFixed(2)} MB total`);
