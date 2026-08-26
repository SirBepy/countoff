import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import serviceWorker from './vite-plugin-sw'

// Relative so the same build works at a domain root and under a GitHub Pages
// repo subpath without knowing the repo name.
export default defineConfig({
  base: './',
  plugins: [react(), serviceWorker('1')],
  server: { port: 5180 },
})
