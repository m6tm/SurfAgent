import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json' with { type: 'json' }

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: process.env.NODE_ENV !== 'production',
    // Evite l'injection de <link rel="modulepreload"> et du polyfill associe
    // dans les content scripts (resources non utilisables en world isole)
    // -> supprime les warnings "cross-world extension resource mismatch".
    modulePreload: false,
  },
})