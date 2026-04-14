import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// Read the repo-root VERSION at build time. In dev/CI the frontend lives
// under repo-root/frontend, so `../VERSION` resolves. Inside the Docker
// image we COPY VERSION next to the app, so `./VERSION` resolves. Fall
// back to "0.0.0" if neither is present.
function readVersion() {
  for (const rel of ['../VERSION', './VERSION']) {
    try {
      return readFileSync(resolve(here, rel), 'utf8').trim() || '0.0.0'
    } catch {
      // try next candidate
    }
  }
  return '0.0.0'
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
