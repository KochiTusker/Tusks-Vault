import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Disabled by DISABLE_HMR=true. File watching fights with an agent
      // editing files underneath it, which shows up as a flickering page.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
