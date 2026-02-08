import { defineConfig } from 'astro/config';
import { copyFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

import icon from 'astro-icon';

// Copy plugin-slots.json and filters.json to dist for client-side access
function copyDataFiles() {
  return {
    name: 'copy-data-files',
    hooks: {
      'astro:build:done': ({ dir }) => {
        mkdirSync(dir, { recursive: true });
        copyFileSync('src/data/plugin-slots.json', `${dir.pathname}plugin-slots.json`);
        copyFileSync('src/data/filters.json', `${dir.pathname}filters.json`);
      }
    }
  };
}

// https://astro.build/config
export default defineConfig({
  site: 'https://tecoholic.github.io/openedx-plugin-slots-browser/',
  base: '/openedx-plugin-slots-browser',
  integrations: [copyDataFiles(), icon()],
  vite: {
    ssr: {
      external: ['fuse.js']
    }
  }
});