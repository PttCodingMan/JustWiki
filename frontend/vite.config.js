import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// Read the repo-root VERSION at build time. The Docker build stage keeps the
// same layout (/src/frontend + /src/VERSION), so `../VERSION` resolves in dev,
// CI and the image alike. Fall back to "0.0.0" if it's missing.
function readVersion() {
  try {
    return readFileSync(resolve(here, '../VERSION'), 'utf8').trim() || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const APP_VERSION = readVersion()

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
