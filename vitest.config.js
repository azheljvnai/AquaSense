import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Ensure backend modules importing `firebase-admin` use our test stub
    alias: {
      'firebase-admin': path.resolve(__dirname, 'tests/mocks/firebase-admin.js'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
