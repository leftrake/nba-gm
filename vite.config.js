import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Served from https://<user>.github.io/nba-gm/ on GitHub Pages
  base: '/nba-gm/',
  plugins: [react()],
});
