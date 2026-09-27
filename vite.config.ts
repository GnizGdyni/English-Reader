import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { localDictPlugin } from './vite-plugin-local-dict.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localDictPlugin()],
  optimizeDeps: {
    include: ['pdfjs-dist/legacy/build/pdf.mjs'],
  },
  worker: {
    format: 'es',
  },
})
