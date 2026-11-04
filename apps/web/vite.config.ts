import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// The e2e suite points the proxy at its own server.
const server = process.env['GROUNDWORK_SERVER_URL'] ?? 'http://127.0.0.1:3000'

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    proxy: {
      '/api/auth': server,
      '/chat': server,
      '/conversations': server,
      '/health': server,
    },
  },
})
