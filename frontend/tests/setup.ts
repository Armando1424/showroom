import '@testing-library/jest-dom/vitest'
import { webcrypto } from 'node:crypto'
import { afterEach, vi } from 'vitest'

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto })
}

if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
