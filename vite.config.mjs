import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => {
  const project = { development: 'base', production: 'base', base: 'base', daoyan: 'daoyan' }[mode];
  if (!project) throw new Error(`未知项目模式：${mode}，请使用 base 或 daoyan`);
  const branded = project === 'base';
  return {
    resolve: { dedupe: ['three'], alias: { '@project': fileURLToPath(new URL(`./src/projects/${project}.js`, import.meta.url)) } },
    cacheDir: `node_modules/.vite-${project}`,
    build: { outDir: 'dist/client' },
    optimizeDeps: { include: ['react', 'react-dom/client'] },
    server: { host: '0.0.0.0', port: branded ? 5173 : 5175, strictPort: true, allowedHosts: ['terminal.local'], warmup: { clientFiles: ['./src/main.jsx'] } },
    plugins: [react(), { name: 'project-document', transformIndexHtml(html) {
      return html.replace('%PROJECT_ID%', project).replace('%PROJECT_ICON%', branded ? '/brand/manes-icon.svg' : 'data:,').replace('%PROJECT_DESCRIPTION%', branded ? '可配置的三维运行监测大屏' : '道研车辆运行监测大屏').replace('%PROJECT_TITLE%', branded ? 'MANES · 全域运行监测中心' : '全域运行监测中心');
    } }],
  };
});
