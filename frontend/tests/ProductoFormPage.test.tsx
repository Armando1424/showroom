import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ProductoFormPage } from '../src/pages/ProductoFormPage'
import type { Producto } from '../src/types'
import { makeQuery } from './helpers'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  storageFrom: vi.fn(),
  auth: { isAdmin: false, isProveedor: true, session: { user: { id: 'u1' } } },
  proveedor: { proveedorId: null as string | null },
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

const producto: Producto = {
  id: 'p1',
  nombre: 'Producto',
  descripcion: 'Descripción',
  precio: 10,
  estado: 'disponible',
  imagen_path: 'p1/old.jpg',
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

function renderCreate() {
  return render(
    <MemoryRouter initialEntries={['/nuevo']}>
      <Routes>
        <Route path="/nuevo" element={<ProductoFormPage />} />
        <Route path="/" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderEdit() {
  return render(
    <MemoryRouter initialEntries={['/productos/p1/editar']}>
      <Routes>
        <Route path="/productos/:id/editar" element={<ProductoFormPage />} />
        <Route path="/" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function uploadPhoto(user: ReturnType<typeof userEvent.setup>) {
  const input = screen.getByLabelText('Elegir de galería') as HTMLInputElement
  await user.upload(input, new File(['x'], 'foto.png', { type: 'image/png' }))
}

describe('ProductoFormPage.onSubmit', () => {
  let bucket: {
    upload: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
    createSignedUrl: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    mocks.from.mockReset()
    mocks.rpc.mockReset()
    mocks.storageFrom.mockReset()

    Object.assign(mocks.auth, {
      isAdmin: false,
      isProveedor: true,
      session: { user: { id: 'u1' } },
    })
    mocks.proveedor.proveedorId = null

    mocks.from.mockImplementation(() => makeQuery({ data: [], error: null }))
    mocks.rpc.mockResolvedValue({ error: null })
    bucket = {
      upload: vi.fn().mockResolvedValue({ data: { path: 'x' }, error: null }),
      remove: vi.fn().mockResolvedValue({ data: [], error: null }),
      createSignedUrl: vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://img.test/old.jpg' },
        error: null,
      }),
    }
    mocks.storageFrom.mockReturnValue(bucket)
    vi.stubGlobal('crypto', { randomUUID: () => 'product-1' })
  })

  it('crea un producto, sube la imagen y navega al inicio', async () => {
    const user = userEvent.setup()
    renderCreate()

    await user.type(screen.getByLabelText('Nombre'), 'Producto')
    await user.type(screen.getByLabelText('Descripción'), 'Descripción')
    await user.type(screen.getByLabelText(/Precio/), '10')
    await uploadPhoto(user)
    await user.click(screen.getByRole('button', { name: 'Crear producto' }))

    await waitFor(() => expect(bucket.upload).toHaveBeenCalledTimes(1))

    const [path, file, options] = bucket.upload.mock.calls[0]
    expect(path).toMatch(/^product-1\/\d+\.png$/)
    expect(file).toBeInstanceOf(File)
    expect(options).toEqual({ contentType: 'image/png', upsert: false })

    const insertQuery = mocks.from.mock.results
      .map((result) => result.value)
      .find((query) => query.insert.mock.calls.length > 0)
    expect(insertQuery).toBeDefined()
    expect(insertQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'product-1',
        nombre: 'Producto',
        descripcion: 'Descripción',
        precio: 10,
        imagen_path: path,
        proveedor_id: 'u1',
      }),
    )

    expect(await screen.findByText('home')).toBeInTheDocument()
  })

  it('valida nombre, imagen y precio antes de guardar', async () => {
    renderCreate()

    const form = screen.getByRole('button', { name: 'Crear producto' }).closest('form')!
    fireEvent.submit(form)
    expect(await screen.findByText('El nombre es obligatorio.')).toBeInTheDocument()

    await userEvent.setup().type(screen.getByLabelText('Nombre'), 'Producto')
    fireEvent.submit(form)
    expect(await screen.findByText('La imagen es obligatoria.')).toBeInTheDocument()

    await userEvent.setup().type(screen.getByLabelText(/Precio/), '-1')
    await userEvent.setup().upload(
      screen.getByLabelText('Elegir de galería') as HTMLInputElement,
      new File(['x'], 'foto.png', { type: 'image/png' }),
    )
    fireEvent.submit(form)
    expect(
      await screen.findByText('El precio debe ser un número mayor o igual a 0.'),
    ).toBeInTheDocument()

    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('exige proveedor al admin antes de crear', async () => {
    Object.assign(mocks.auth, {
      isAdmin: true,
      isProveedor: false,
      session: { user: { id: 'admin' } },
    })

    const user = userEvent.setup()
    renderCreate()
    await user.type(screen.getByLabelText('Nombre'), 'Producto')
    await uploadPhoto(user)
    await user.click(screen.getByRole('button', { name: 'Crear producto' }))

    expect(
      await screen.findByText('Elige un proveedor en la barra superior antes de crear el producto.'),
    ).toBeInTheDocument()
    expect(bucket.upload).not.toHaveBeenCalled()
  })

  it('edita un producto existente sin cambiar la imagen', async () => {
    mocks.from.mockImplementation(() => makeQuery({ data: producto, error: null }))

    const user = userEvent.setup()
    renderEdit()

    const nombre = await screen.findByLabelText('Nombre')
    expect(nombre).toHaveValue('Producto')

    await user.clear(nombre)
    await user.type(nombre, 'Producto editado')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('actualizar_producto', {
        p_id: 'p1',
        p_nombre: 'Producto editado',
        p_descripcion: 'Descripción',
        p_precio: 10,
      }),
    )
    expect(bucket.upload).not.toHaveBeenCalled()
    expect(await screen.findByText('home')).toBeInTheDocument()
  })

  it('bloquea la edición si el usuario no es el dueño ni admin', async () => {
    Object.assign(mocks.auth, {
      isAdmin: false,
      isProveedor: true,
      session: { user: { id: 'u2' } },
    })
    mocks.from.mockImplementation(() => makeQuery({ data: producto, error: null }))

    renderEdit()

    expect(await screen.findByText('No autorizado')).toBeInTheDocument()
  })
})
