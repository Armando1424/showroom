import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/dom'
import { webcrypto } from 'node:crypto'
import { afterEach, vi } from 'vitest'

configure({ asyncUtilTimeout: 5000 })

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
