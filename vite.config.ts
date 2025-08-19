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
      external: [],
      output: {
        format: 'es'
      }
    },
    sourcemap: true,
    commonjsOptions: {
      transformMixedEsModules: true
    }
  },
  define: {
    global: 'globalThis',
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production')
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
});