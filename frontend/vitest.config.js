import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = resolve(fileURLToPath(import.meta.url), '..')

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
  },
  // The automatic JSX runtime lets components (and `.test.jsx` tests) write
  // JSX without importing React. `@vitejs/plugin-react` handles this for the
  // dev/build pipeline; esbuild needs the same hint for test transforms.
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
