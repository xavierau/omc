import { defineConfig } from 'vitest/config'
import path from 'path'

const root = path.resolve(__dirname, '../../../..')

export default defineConfig({
  root,
  resolve: { alias: { '@': path.resolve(root, 'src') } },
  test: {
    globals: false,
    include: ['.claude-workspace/artifacts/evidence/2026-11-19-book-003-r4/*.test.ts'],
  },
})
