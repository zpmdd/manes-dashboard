import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const project of ['base', 'daoyan']) {
  const directory = path.join(root, 'releases', project);
  for (const file of ['client/index.html', 'server/index.js', '.openai/hosting.json', 'project.json']) assert(existsSync(path.join(directory, file)), `${project} missing ${file}`);
  const html = readFileSync(path.join(directory, 'client/index.html'), 'utf8');
  assert(html.includes(`data-project="${project}"`)); assert(!html.includes('%PROJECT_'));
  assert.equal(JSON.parse(readFileSync(path.join(directory, 'project.json'))).project, project);
  assert(html.includes(project === 'base' ? 'href="/brand/manes-icon.svg"' : 'href="data:,"'));
  const assets = path.join(directory, 'client/assets');
  const bundle = readdirSync(assets).filter(file => file.endsWith('.js')).map(file => readFileSync(path.join(assets, file), 'utf8')).join('\n');
  for (const marker of ['ds_daoyan_vehicles', '2026/9/13 00:00', '00000000000000000000000000000011']) assert.equal(bundle.includes(marker), project === 'daoyan', `${project} project data boundary: ${marker}`);
  console.log(`PASS: ${project} 独立产物、品牌及项目数据边界`);
}
