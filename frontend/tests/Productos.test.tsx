import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Productos } from '../src/pages/Productos'
import type { Producto } from '../src/types'
import { makeQuery } from './helpers'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  storageFrom: vi.fn(),
  auth: { session: { user: { id: 'u1' } }, isAdmin: false, isProveedor: true },
  proveedor: { proveedorId: 'prov1', requiereSeleccion: false },
}))

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
    storage: { from: mocks.storageFrom },
  },
}))

vi.mock('../src/auth/AuthProvider', () => ({
  useAuth: () => mocks.auth,
}))

vi.mock('../src/proveedor/ProveedorProvider', () => ({
  useProveedor: () => mocks.proveedor,
}))

const disponible: Producto = {
  id: 'p1',
  nombre: 'Café',
  descripcion: 'Grano de altura',
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

const vendido: Producto = {
  ...disponible,
  id: 'p2',
  nombre: 'Taza',
  estado: 'vendido',
  metodo_pago: 'efectivo',
  precio_venta: 80,
  sold_at: '2026-01-02T00:00:00Z',
}

describe('Productos', () => {
  beforeEach(() => {
    mocks.from.mockReset()
    mocks.rpc.mockReset()
    mocks.storageFrom.mockReset()

    Object.assign(mocks.auth, {
      session: { user: { id: 'u1' } },
      isAdmin: false,
      isProveedor: true,
    })
    Object.assign(mocks.proveedor, { proveedorId: 'prov1', requiereSeleccion: false })

    mocks.from.mockImplementation((table: string) =>
      makeQuery({
        data: table === 'productos' ? [disponible, vendido] : [],
        error: null,
      }),
    )
    mocks.rpc.mockResolvedValue({ error: null })
    mocks.storageFrom.mockReturnValue({
      createSignedUrl: vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://img.test/p1.jpg' },
        error: null,
      }),
    })
  })

  it('lista disponibles/vendidos y devuelve un producto vendido', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <MemoryRouter>
        <Productos />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: /Café/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Disponibles \(1\)/ })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /Vendidos \(1\)/ }))
    expect(await screen.findByRole('button', { name: /Taza/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Café/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Taza/ }))
    await user.click(screen.getByRole('button', { name: 'Devolver' }))

    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('devolver_producto', { p_id: 'p2' }),
    )
  })

  it('vende un producto disponible en efectivo y firma la imagen', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Productos />
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole('button', { name: /Café/ }))
    expect(mocks.storageFrom).toHaveBeenCalledWith('productos')
    expect(screen.getByRole('heading', { name: 'Café' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Vender' }))
    expect(screen.getByRole('heading', { name: /Cobrar “Café”/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Efectivo' }))

    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('marcar_vendido', {
        p_id: 'p1',
        p_metodo_pago: 'efectivo',
        p_precio: 120,
      }),
    )
  })

  it('filtra por búsqueda y limpia el filtro', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Productos />
      </MemoryRouter>,
    )

    await screen.findByRole('button', { name: /Café/ })
    await user.type(screen.getByLabelText('Buscar productos'), 'café')
    expect(screen.getByRole('button', { name: /Café/ })).toBeInTheDocument()

    await user.type(screen.getByLabelText('Buscar productos'), 'zzz')
    expect(screen.getByText('No hay productos disponibles.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Limpiar' }))
    expect(await screen.findByRole('button', { name: /Café/ })).toBeInTheDocument()
  })

  it('pide elegir proveedor al admin sin selección', async () => {
    mocks.proveedor.requiereSeleccion = true
    render(
      <MemoryRouter>
        <Productos />
      </MemoryRouter>,
    )

    expect(
      await screen.findByText('Elige un proveedor en la barra superior para ver sus productos.'),
    ).toBeInTheDocument()
  })
})
