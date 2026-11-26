import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProveedorProvider, useProveedor } from '../src/proveedor/ProveedorProvider'
import type { Profile } from '../src/types'
import { makeQuery } from './helpers'

const mocks = vi.hoisted(() => ({
  auth: {
    profile: null as Partial<Profile> | null,
    roles: [] as string[],
    isAdmin: false,
    isProveedor: false,
  },
  from: vi.fn(),
  proveedores: [] as Profile[],
}))

vi.mock('../src/lib/supabase', () => ({
  supabase: { from: mocks.from },
}))

vi.mock('../src/auth/AuthProvider', () => ({
  useAuth: () => mocks.auth,
}))

const proveedor: Profile = {
  id: 'prov1',
  nombre: 'Proveedor Uno',
  email: 'proveedor@example.com',
  activo: true,
  proveedor_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function Consumer() {
  const { proveedorId, proveedores, requiereSeleccion, setProveedorId } = useProveedor()
  return (
    <div>
      <span data-testid="proveedor">{proveedorId ?? 'none'}</span>
      <span data-testid="requiere">{String(requiereSeleccion)}</span>
      <span data-testid="lista">{proveedores.map((item) => item.nombre).join(',')}</span>
      <button onClick={() => setProveedorId('prov1')}>select</button>
      <button onClick={() => setProveedorId(null)}>clear</button>
    </div>
  )
}

describe('ProveedorProvider', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.from.mockReset()
    mocks.auth = {
      profile: null,
      roles: [],
      isAdmin: false,
      isProveedor: false,
    }
    mocks.proveedores = [proveedor]
    mocks.from.mockImplementation((table: string) => {
      if (table === 'user_roles') return makeQuery({ data: [{ user_id: 'prov1' }], error: null })
      if (table === 'profiles') return makeQuery({ data: mocks.proveedores, error: null })
      return makeQuery({ data: [], error: null })
    })
  })

  it('el admin carga proveedores y requiere selección', async () => {
    mocks.auth = {
      profile: { id: 'admin', nombre: 'Administrador' },
      roles: ['admin'],
      isAdmin: true,
      isProveedor: true,
    }

    const user = userEvent.setup()
    render(
      <ProveedorProvider>
        <Consumer />
      </ProveedorProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('lista')).toHaveTextContent('Proveedor Uno'))
    expect(screen.getByTestId('proveedor')).toHaveTextContent('none')
    expect(screen.getByTestId('requiere')).toHaveTextContent('true')

    await user.click(screen.getByRole('button', { name: 'select' }))
    expect(screen.getByTestId('proveedor')).toHaveTextContent('prov1')
    expect(screen.getByTestId('requiere')).toHaveTextContent('false')
    expect(localStorage.getItem('showroom.proveedor')).toBe('prov1')

    await user.click(screen.getByRole('button', { name: 'clear' }))
    expect(localStorage.getItem('showroom.proveedor')).toBeNull()
    expect(screen.getByTestId('requiere')).toHaveTextContent('true')
  })

  it('el admin recupera la selección de localStorage', () => {
    localStorage.setItem('showroom.proveedor', 'prov1')
    mocks.auth = {
      profile: { id: 'admin' },
      roles: ['admin'],
      isAdmin: true,
      isProveedor: true,
    }

    render(
      <ProveedorProvider>
        <Consumer />
      </ProveedorProvider>,
    )

    expect(screen.getByTestId('proveedor')).toHaveTextContent('prov1')
    expect(screen.getByTestId('requiere')).toHaveTextContent('false')
  })

  it('un proveedor usa su propio id y no consulta la lista', () => {
    mocks.auth = {
      profile: { id: 'p1', nombre: 'Proveedor' },
      roles: ['proveedor'],
      isAdmin: false,
      isProveedor: true,
    }

    render(
      <ProveedorProvider>
        <Consumer />
      </ProveedorProvider>,
    )

    expect(screen.getByTestId('proveedor')).toHaveTextContent('p1')
    expect(screen.getByTestId('requiere')).toHaveTextContent('false')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('un vendedor usa el proveedor asignado', () => {
    mocks.auth = {
      profile: { id: 'u2', nombre: 'Vendedor', proveedor_id: 'p2' },
      roles: ['vendedor'],
      isAdmin: false,
      isProveedor: false,
    }

    render(
      <ProveedorProvider>
        <Consumer />
      </ProveedorProvider>,
    )

    expect(screen.getByTestId('proveedor')).toHaveTextContent('p2')
    expect(screen.getByTestId('requiere')).toHaveTextContent('false')
  })

  it('un vendedor sin proveedor no tiene proveedor efectivo', () => {
    mocks.auth = {
      profile: { id: 'u3', nombre: 'Vendedor', proveedor_id: null },
      roles: ['vendedor'],
      isAdmin: false,
      isProveedor: false,
    }

    render(
      <ProveedorProvider>
        <Consumer />
      </ProveedorProvider>,
    )

    expect(screen.getByTestId('proveedor')).toHaveTextContent('none')
    expect(screen.getByTestId('requiere')).toHaveTextContent('false')
  })
})
