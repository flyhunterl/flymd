import { defineConfig } from 'vite'

const DEV_CSP = [
  "default-src 'self'",
  "img-src 'self' https: http: asset: blob: data:",
  "style-src 'self' 'unsafe-inline' blob:",
  "font-src 'self' data:",
  "script-src 'self' http: https: 'unsafe-eval' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' ipc: http: https: ws: http://ipc.localhost",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ')

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      // 将 Node 内置的 punycode 指向浏览器版 polyfill，修复 markdown-it 在浏览器端的链接规范化报错
      punycode: 'punycode/'
    }
  },
  server: {
    port: 5173,
    strictPort: false
  },
  build: {
    // 为了使用动态 import 和顶层 await
    target: 'es2022'
  }
})
