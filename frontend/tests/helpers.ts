import { vi } from 'vitest'

export type QueryResult = {
  data?: unknown
  error?: { message: string } | null
}

/** Query builder mínimo y thenable para los componentes que usan Supabase. */
export function makeQuery(result: QueryResult = { data: [], error: null }) {
  const query: Record<string, any> = {}

  for (const method of [
    'select',
    'order',
    'eq',
    'in',
    'is',
    'update',
    'insert',
    'delete',
    'upsert',
  ]) {
    query[method] = vi.fn(() => query)
  }

  query.maybeSingle = vi.fn(() => Promise.resolve(result))
  query.single = vi.fn(() => Promise.resolve(result))
  query.then = (onFulfilled: any, onRejected: any) =>
    Promise.resolve(result).then(onFulfilled, onRejected)

  return query as any
}

/** Bucket de Storage mockeado. */
export function makeStorage() {
  const bucket = {
    createSignedUrl: vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://img.test/x' },
      error: null,
    }),
    upload: vi.fn().mockResolvedValue({ data: { path: 'x' }, error: null }),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
  }

  return {
    bucket,
    storage: { from: vi.fn(() => bucket) },
  }
}
