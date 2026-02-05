import { defineConfig } from 'astro/config';
import { copyFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

import icon from 'astro-icon';

// Copy plugin-slots.json to dist for client-side access
function copyPluginsJson() {
  return {
    name: 'copy-plugins-json',
    hooks: {
      'astro:build:done': ({ dir }) => {
        mkdirSync(dir, { recursive: true });
        copyFileSync('src/data/plugin-slots.json', `${dir.pathname}plugin-slots.json`);
      }
    }
  };
}

// https://astro.build/config
export default defineConfig({
  site: 'https://tecoholic.github.io/openedx-plugin-slots-browser/',
  base: '/openedx-plugin-slots-browser',
  integrations: [copyPluginsJson(), icon()],
  vite: {
    ssr: {
      external: ['fuse.js']
    }
  }
});