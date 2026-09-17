import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const project = process.argv[2];
if (!['base', 'daoyan'].includes(project)) throw new Error('构建项目必须是 base 或 daoyan');
const root = fileURLToPath(new URL('../', import.meta.url));
for (const args of [['node_modules/vite/bin/vite.js', 'build', '--mode', project], ['scripts/prepare-sites-build.mjs']]) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const destination = path.join(root, 'releases', project);
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(path.join(root, 'dist'), destination, { recursive: true });
writeFileSync(path.join(destination, 'project.json'), JSON.stringify({ project }, null, 2) + '\n');
console.log(`已生成 ${project}：releases/${project}/client；Sites 产物仍保留在 dist/`);
