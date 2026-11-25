import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Layout } from '../src/components/Layout'

const mocks = vi.hoisted(() => ({
  auth: {
    profile: { nombre: 'Administrador', proveedor_id: null },
    roles: ['admin', 'proveedor', 'vendedor'],
    signOut: vi.fn(),
    isAdmin: true,
    isProveedor: true,
  },
  proveedor: {
    proveedores: [{ id: 'prov1', nombre: 'Proveedor Uno', email: 'p@example.com' }],
    proveedorId: 'prov1',
    setProveedorId: vi.fn(),
    loading: false,
  },
}))

vi.mock('../src/auth/AuthProvider', () => ({
  useAuth: () => mocks.auth,
}))

vi.mock('../src/proveedor/ProveedorProvider', () => ({
  useProveedor: () => mocks.proveedor,
}))

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<div>contenido</div>} />
          <Route path="/login" element={<div>login</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('Layout', () => {
  beforeEach(() => {
    Object.assign(mocks.auth, {
      profile: { nombre: 'Administrador', proveedor_id: null },
      roles: ['admin', 'proveedor', 'vendedor'],
      isAdmin: true,
      isProveedor: true,
    })
    mocks.auth.signOut.mockReset()
    mocks.auth.signOut.mockResolvedValue(undefined)

    Object.assign(mocks.proveedor, {
      proveedores: [{ id: 'prov1', nombre: 'Proveedor Uno', email: 'p@example.com' }],
      proveedorId: 'prov1',
      loading: false,
    })
    mocks.proveedor.setProveedorId.mockReset()
  })

  it('muestra el selector de proveedor y cierra sesión', async () => {
    const user = userEvent.setup()
    renderLayout()

    expect(screen.getByText('contenido')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Usuarios' })).toBeInTheDocument()
    expect(screen.getByText('Administrador')).toBeInTheDocument()
    expect(screen.getByText('admin, proveedor, vendedor')).toBeInTheDocument()

    const selector = screen.getByLabelText('Proveedor')
    await user.selectOptions(selector, '')
    expect(mocks.proveedor.setProveedorId).toHaveBeenCalledWith(null)

    await user.click(screen.getByRole('button', { name: 'Salir' }))
    expect(mocks.auth.signOut).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('login')).toBeInTheDocument()
  })

  it('avisa al vendedor sin proveedor asignado', async () => {
    Object.assign(mocks.auth, {
      profile: { nombre: 'Vendedor', proveedor_id: null },
      roles: ['vendedor'],
      isAdmin: false,
      isProveedor: false,
    })

    renderLayout()

    expect(screen.getByText('sin proveedor asignado')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Usuarios' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Proveedor')).not.toBeInTheDocument()
  })
})
