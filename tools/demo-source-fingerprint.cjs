/* Build inputs for the workbench shared with InsightChat. No generated artifacts. */
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const WORKBENCH_INPUTS = [
  'apps/web/config-relation-plane-baseline', 'apps/mcp-server/ui/src',
  'apps/mcp-server/vite.config.js', 'apps/mcp-server/src/app-resource.js',
  'apps/mcp-server/package.json', 'packages/config-core/src', 'packages/config-core/package.json',
  'packages/contracts', 'package.json', 'package-lock.json',
  'tools/package-github-pages.ps1', 'tools/demo-source-fingerprint.cjs',
];
const sha256 = value => createHash('sha256').update(value).digest('hex');
// Git's Windows/Linux newline conversion must not look like a source change.
function contentHash(buffer) {
  return sha256(buffer.includes(0) ? buffer : buffer.toString('utf8').replace(/\r\n/g, '\n'));
}
function fingerprint(root, inputs = WORKBENCH_INPUTS) {
  const files = [];
  function visit(relative) {
    const absolute = path.join(root, relative);
    if (fs.statSync(absolute).isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) {
        if (!['node_modules', '.git', 'dist'].includes(name)) visit(relative+'/'+name);
      }
    } else files.push({path:relative.replaceAll('\\', '/'), sha256:contentHash(fs.readFileSync(absolute))});
  }
  for (const input of inputs) visit(input);
  files.sort((a,b)=>a.path.localeCompare(b.path, 'en'));
  return {schema_version:1, sha256:sha256(JSON.stringify(files)), files};
}
module.exports = {fingerprint, contentHash, WORKBENCH_INPUTS};
if (require.main === module) console.log(JSON.stringify(fingerprint(path.resolve(__dirname, '..'))));
