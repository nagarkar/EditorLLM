const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DIST_HELP = path.join(DIST, 'help');

if (!fs.existsSync(DIST)) {
  console.error('[flatten_help_partials] dist/ does not exist.');
  process.exit(1);
}

if (!fs.existsSync(DIST_HELP)) {
  console.log('[flatten_help_partials] No dist/help directory found; nothing to flatten.');
  process.exit(0);
}

const helpFiles = fs.readdirSync(DIST_HELP)
  .filter(name => name.endsWith('.html'))
  .sort();

for (const fileName of helpFiles) {
  const sourcePath = path.join(DIST_HELP, fileName);
  const targetPath = path.join(DIST, fileName);
  fs.renameSync(sourcePath, targetPath);
}

const topLevelHtmlFiles = fs.readdirSync(DIST)
  .filter(name => name.endsWith('.html'))
  .sort();

for (const fileName of topLevelHtmlFiles) {
  const filePath = path.join(DIST, fileName);
  const original = fs.readFileSync(filePath, 'utf8');
  const rewritten = original.replace(
    /include\((['"])help\/([^'"]+)\1\)/g,
    'include($1$2$1)'
  );
  if (rewritten !== original) {
    fs.writeFileSync(filePath, rewritten, 'utf8');
  }
}

console.log(`[flatten_help_partials] Flattened ${helpFiles.length} help partial(s) into dist/.`);
