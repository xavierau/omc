import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', '.claude/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'src/domain/**/*.ts',
        'src/application/**/*.ts',
        'src/infrastructure/supabase/repositories/coupon-mapper.ts',
        'src/infrastructure/supabase/guards/**/*.ts',
        'src/infrastructure/kapso/webhook-parser.ts',
        'src/infrastructure/flowforge/receipt-mapper.ts',
        'src/infrastructure/validation/**/*.ts',
        'src/infrastructure/rate-limit/**/*.ts',
        'src/infrastructure/logging/**/*.ts',
        'src/lib/**/*.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/test-utils/**',
        'src/lib/utils.ts',
        'src/lib/supabase-broadcast.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
      },
    },
  },
})
