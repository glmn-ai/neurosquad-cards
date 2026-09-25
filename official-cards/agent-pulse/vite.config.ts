/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The app serves the built card from nscard://<id>/dist/…, so every URL must be
// relative (base './'). Commit dist/: installs come straight from the repository.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The card CSP allows scripts only from the package; no inline preload polyfill.
    modulePreload: { polyfill: false },
    target: 'es2022'
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node'
  }
})
