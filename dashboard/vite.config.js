import react from '@vitejs/plugin-react';
import path from 'path';

export default {
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001', // Assuming express runs on 3000
        changeOrigin: true,
      }
    }
  },
  build: {
    chunkSizeWarningLimit: 900,
  },
};
