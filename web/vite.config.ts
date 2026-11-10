import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const source = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const comment = source.match(/<body>\s*(<!--[\s\S]*?-->)/)?.[1];
if (!comment || !comment.includes('997d7f7f')) throw new Error('Missing opening direction contract');

export default defineConfig({
  base: './',
  envDir: false,
  plugins: [
    react(),
    {
      name: 'preserve-opening-direction-contract',
      enforce: 'post',
      generateBundle(_options, bundle) {
        const html = bundle['index.html'];
        if (html?.type !== 'asset' || typeof html.source !== 'string') throw new Error('Missing production HTML');
        html.source = html.source
          .replace(/<!--[\s\S]*?-->/g, item => item.includes('997d7f7f') ? '' : item)
          .replace(/<body>/, `<body>\n${comment}`);
      }
    }
  ],
  build: { target: 'es2022', sourcemap: false }
});
