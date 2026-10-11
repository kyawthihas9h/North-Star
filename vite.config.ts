import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    https: process.env.HTTPS_CERT_FILE && process.env.HTTPS_KEY_FILE
      ? {
          cert: readFileSync(process.env.HTTPS_CERT_FILE),
          key: readFileSync(process.env.HTTPS_KEY_FILE),
        }
      : undefined,
    proxy: { '/api': 'http://localhost:3001', '/uploads': 'http://localhost:3001' },
  },
})
