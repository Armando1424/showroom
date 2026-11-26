import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Visibilidad } from '../src/pages/Visibilidad'
import type { Producto, ProductVisibility } from '../src/types'
import { makeQuery } from './helpers'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  auth: { isAdmin: false, session: { user: { id: 'u1' } } },
  items: [] as ProductVisibility[],
  perfiles: [] as { id: string; nombre: string; email: string | null; activo: boolean }[],
}))

vi.mock('../src/lib/supabase', () => ({
  supabase: { from: mocks.from },
}))

vi.mock('../src/auth/AuthProvider', () => ({
  useAuth: () => mocks.auth,
}))

const producto: Producto = {
  id: 'p1',
  nombre: 'Café',
  descripcion: 'Grano',
  precio: 120,
  estado: 'disponible',
  imagen_path: 'p1/foto.jpg',
  proveedor_id: 'prov1',
  metodo_pago: null,
  precio_venta: null,
  created_by: 'u1',
  updated_by: null,
  sold_by: null,
  sold_at: null,
  deleted_at: null,
  deleted_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const accesos: ProductVisibility[] = [
  {
    id: 'v1',
    producto_id: 'p1',
    user_id: 'u2',
    rol: null,
    granted_by: 'u1',
    granted_at: '2026-01-02T00:00:00Z',
  },
  {
    id: 'v2',
    producto_id: 'p1',
    user_id: null,
    rol: 'vendedor',
    granted_by: 'u1',
    granted_at: '2026-01-03T00:00:00Z',
  },
]

const perfiles = [
  { id: 'u2', nombre: 'Will', email: 'will@example.com', activo: true },
  { id: 'u3', nombre: 'Inactivo', email: null, activo: false },
]

function renderVisibilidad() {
  return render(
    <MemoryRouter initialEntries={['/productos/p1/visibilidad']}>
      <Routes>
        <Route path="/productos/:id/visibilidad" element={<Visibilidad />} />
      </Routes>
    </MemoryRouter>,
  )
}

function findQueryWith(method: 'insert' | 'delete') {
  return mocks.from.mock.results
    .map((result) => result.value)
    .find((query) => query[method].mock.calls.length > 0)
}

describe('Visibilidad', () => {
  beforeEach(() => {
    mocks.from.mockReset()
    mocks.auth.isAdmin = false
    mocks.auth.session = { user: { id: 'u1' } }
    mocks.items = accesos
    mocks.perfiles = perfiles

    mocks.from.mockImplementation((table: string) => {
      if (table === 'productos') return makeQuery({ data: producto, error: null })
      if (table === 'product_visibility') return makeQuery({ data: mocks.items, error: null })
      if (table === 'profiles') return makeQuery({ data: mocks.perfiles, error: null })
      return makeQuery({ data: [], error: null })
    })
  })

  it('muestra el producto y los accesos actuales', async () => {
    renderVisibilidad()

    expect(await screen.findByText('Visibilidad')).toBeInTheDocument()
    expect(screen.getByText('Café')).toBeInTheDocument()
    expect(screen.getAllByText('Will (will@example.com)').length).toBeGreaterThan(0)
    expect(screen.getByText('rol: vendedor')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Revocar' })).toHaveLength(2)
  })

  it('otorga acceso a un usuario', async () => {
    const user = userEvent.setup()
    renderVisibilidad()
    await screen.findByText('Visibilidad')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Usuario' }), 'u2')
    await user.click(screen.getByRole('button', { name: 'Otorgar' }))

    await waitFor(() => {
      const query = findQueryWith('insert')
      expect(query).toBeDefined()
      expect(query.insert).toHaveBeenCalledWith({
        producto_id: 'p1',
        user_id: 'u2',
        rol: null,
      })
    })
  })

  it('otorga acceso por rol', async () => {
    const user = userEvent.setup()
    renderVisibilidad()
    await screen.findByText('Visibilidad')

    await user.click(screen.getByRole('radio', { name: 'Rol' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Rol' }), 'proveedor')
    await user.click(screen.getByRole('button', { name: 'Otorgar' }))

    await waitFor(() => {
      const query = findQueryWith('insert')
      expect(query.insert).toHaveBeenCalledWith({
        producto_id: 'p1',
        user_id: null,
        rol: 'proveedor',
      })
    })
  })

  it('revoca un acceso', async () => {
    const user = userEvent.setup()
    renderVisibilidad()
    await screen.findByText('Visibilidad')

    await user.click(screen.getAllByRole('button', { name: 'Revocar' })[0])

    await waitFor(() => {
      const query = findQueryWith('delete')
      expect(query).toBeDefined()
      expect(query.eq).toHaveBeenCalledWith('id', 'v1')
    })
  })

  it('valida que haya usuario antes de otorgar', async () => {
    const user = userEvent.setup()
    renderVisibilidad()
    await screen.findByText('Visibilidad')

    await user.click(screen.getByRole('button', { name: 'Otorgar' }))

    expect(await screen.findByText('Selecciona un usuario.')).toBeInTheDocument()
    expect(findQueryWith('insert')).toBeUndefined()
  })

  it('bloquea a quien no es dueño ni admin', async () => {
    mocks.auth.session = { user: { id: 'u9' } }
    renderVisibilidad()

    expect(await screen.findByText('No autorizado')).toBeInTheDocument()
  })

  it('muestra error si el producto no existe', async () => {
    mocks.from.mockImplementation((table: string) =>
      table === 'productos'
        ? makeQuery({ data: null, error: { message: 'Producto no encontrado' } })
        : makeQuery({ data: [], error: null }),
    )

    renderVisibilidad()

    expect(await screen.findByText('Producto no encontrado')).toBeInTheDocument()
  })
})
