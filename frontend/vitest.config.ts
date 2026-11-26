import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://test.supabase.co'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-anon-key'),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 30000,
    pool: 'forks',
    poolOptions: {
      forks: { maxForks: 2 },
    },
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      reporter: ['json'],
      reportsDirectory: 'coverage',
      exclude: ['src/main.tsx', 'src/vite-env.d.ts', 'src/lib/supabase.ts'],
    },
  },
})
