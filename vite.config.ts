import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
    base: '',
    server: {
    proxy: {
      '/oam-tiles': {
        target: 'https://tiles.openaerialmap.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/oam-tiles/, ''),
        // Optional: add headers to avoid redirection issues
        headers: {
          'Origin': 'https://tiles.openaerialmap.org'
        }
      }
    }
  }
});

