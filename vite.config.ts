import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    strictPort: false
  },
  build: {
    // 允许使用动态 import 带来的顶层 await 代码拆分
    target: 'es2022'
  }
})
