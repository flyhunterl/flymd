import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    strictPort: false
  },
  build: {
    target: 'es2020'
  }
})
