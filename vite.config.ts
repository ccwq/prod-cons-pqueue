import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'ProdConsPQueue',
      fileName: 'index'
    },
    rollupOptions: {
      external: ['p-queue'],
      output: {
        globals: {
          'p-queue': 'PQueue'
        }
      }
    },
    sourcemap: true
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
});