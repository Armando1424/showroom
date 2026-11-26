import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminUsuarios } from '../src/pages/AdminUsuarios'
import type { Profile, UserRole } from '../src/types'
import { makeQuery } from './helpers'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  profiles: [] as unknown[],
  roles: [] as unknown[],
  proveedores: [] as unknown[],
}))

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: mocks.from,
    functions: { invoke: mocks.invoke },
    rpc: mocks.rpc,
  },
}))

vi.mock('../src/auth/AuthProvider', () => ({
  useAuth: () => ({ isAdmin: true }),
}))

vi.mock('../src/proveedor/ProveedorProvider', () => ({
  useProveedor: () => ({ proveedores: mocks.proveedores }),
}))

describe('AdminUsuarios.crearUsuario', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.from.mockReset()
    mocks.rpc.mockReset()
    mocks.invoke.mockResolvedValue({ data: { user_id: 'user-1' }, error: null })
    mocks.rpc.mockResolvedValue({ error: null })
    mocks.profiles = []
    mocks.roles = []
    mocks.proveedores = []
    mocks.from.mockImplementation((table: string) =>
      makeQuery({
        data:
          table === 'profiles'
            ? mocks.profiles
            : table === 'user_roles'
              ? mocks.roles
              : [],
        error: null,
      }),
    )
  })

  it('crea el usuario con correo interno y guarda el correo de contacto', async () => {
    const user = userEvent.setup()
    render(<AdminUsuarios />)

    await screen.findByText('Agregar usuario')

    await user.type(screen.getByLabelText(/Usuario/), 'will2')
    await user.type(screen.getByLabelText('Nombre'), 'Will Dos')
    await user.type(screen.getByLabelText(/Correo de contacto/), 'will2@example.com')
    await user.type(screen.getByLabelText('Contraseña'), 'Secreta123')
    await user.click(screen.getByRole('button', { name: 'Crear usuario' }))

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1))

    expect(mocks.invoke).toHaveBeenCalledWith('admin-users', {
      body: {
        email: 'will2@showroom.local',
        nombre: 'Will Dos',
        password: 'Secreta123',
      },
    })

    expect(
      await screen.findByText(/Usuario @will2 creado con roles: proveedor, vendedor/),
    ).toBeInTheDocument()

    const profileQuery = mocks.from.mock.results
      .map((result) => result.value)
      .find((query) => query.update.mock.calls.length > 0)
    expect(profileQuery?.update).toHaveBeenCalledWith({ email: 'will2@example.com' })
  })

  it('valida el usuario obligatorio sin llamar a la Edge Function', async () => {
    render(<AdminUsuarios />)
    await screen.findByText('Agregar usuario')

    fireEvent.submit(
      screen.getByRole('button', { name: 'Crear usuario' }).closest('form') as HTMLFormElement,
    )

    expect(screen.getByText(/El usuario es obligatorio/)).toBeInTheDocument()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('muestra el error si la Edge Function falla', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error('El correo ya existe') })

    const user = userEvent.setup()
    render(<AdminUsuarios />)
    await screen.findByText('Agregar usuario')

    await user.type(screen.getByLabelText(/Usuario/), 'will3')
    await user.type(screen.getByLabelText('Nombre'), 'Will Tres')
    await user.type(screen.getByLabelText(/Correo de contacto/), 'will3@example.com')
    await user.type(screen.getByLabelText('Contraseña'), 'Secreta123')
    await user.click(screen.getByRole('button', { name: 'Crear usuario' }))

    expect(await screen.findByText('El correo ya existe')).toBeInTheDocument()
  })

  it('lista usuarios y permite cambiar roles, estado y proveedor', async () => {
    const profile: Profile = {
      id: 'u2',
      nombre: 'Will',
      email: 'will@example.com',
      activo: false,
      proveedor_id: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    const role: UserRole = {
      id: 'r1',
      user_id: 'u2',
      rol: 'vendedor',
      granted_by: 'u1',
      granted_at: '2026-01-01T00:00:00Z',
    }
    const proveedor: Profile = {
      ...profile,
      id: 'prov1',
      nombre: 'Proveedor Uno',
      email: 'p@example.com',
      activo: true,
    }

    mocks.profiles = [profile]
    mocks.roles = [role]
    mocks.proveedores = [proveedor]

    const user = userEvent.setup()
    render(<AdminUsuarios />)

    expect(await screen.findByText('Will')).toBeInTheDocument()
    expect(screen.getByText('pendiente')).toBeInTheDocument()
    expect(screen.getByTitle('Quitar rol')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Añadir rol' }))
    await waitFor(() => {
      const insert = mocks.from.mock.results
        .map((result) => result.value)
        .find((query) => query.insert.mock.calls.length > 0)
      expect(insert).toBeDefined()
      expect(insert.insert).toHaveBeenCalledWith({ user_id: 'u2', rol: 'vendedor' })
    })

    await user.click(screen.getByTitle('Quitar rol'))
    await waitFor(() => {
      const remove = mocks.from.mock.results
        .map((result) => result.value)
        .find((query) => query.delete.mock.calls.length > 0)
      expect(remove).toBeDefined()
      expect(remove.eq).toHaveBeenCalledWith('id', 'r1')
    })

    await user.click(screen.getByRole('button', { name: 'Activar' }))
    await waitFor(() => {
      const update = mocks.from.mock.results
        .map((result) => result.value)
        .find((query) => query.update.mock.calls.length > 0)
      expect(update).toBeDefined()
      expect(update.update).toHaveBeenCalledWith({ activo: true })
    })

    await user.selectOptions(screen.getByTitle('Proveedor asignado'), 'prov1')
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('asignar_proveedor', {
        p_user: 'u2',
        p_proveedor: 'prov1',
      }),
    )
  })

  it('muestra el detalle de un FunctionsHttpError', async () => {
    const error = new Error('fallback') as Error & { context?: Response }
    error.context = new Response(JSON.stringify({ error: 'detalle del servidor' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
    mocks.invoke.mockResolvedValue({ data: null, error })

    const user = userEvent.setup()
    render(<AdminUsuarios />)
    await screen.findByText('Agregar usuario')

    await user.type(screen.getByLabelText(/Usuario/), 'will4')
    await user.type(screen.getByLabelText('Nombre'), 'Will Cuatro')
    await user.type(screen.getByLabelText(/Correo de contacto/), 'will4@example.com')
    await user.type(screen.getByLabelText('Contraseña'), 'Secreta123')
    await user.click(screen.getByRole('button', { name: 'Crear usuario' }))

    expect(await screen.findByText('detalle del servidor')).toBeInTheDocument()
  })

  it('crea un vendedor solo con proveedor asignado', async () => {
    const proveedor: Profile = {
      id: 'prov1',
      nombre: 'Proveedor Uno',
      email: 'p@example.com',
      activo: true,
      proveedor_id: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    mocks.proveedores = [proveedor]

    const user = userEvent.setup()
    render(<AdminUsuarios />)
    await screen.findByText('Agregar usuario')

    await user.type(screen.getByLabelText(/Usuario/), 'vendedor1')
    await user.type(screen.getByLabelText('Nombre'), 'Vendedor Uno')
    await user.type(screen.getByLabelText(/Correo de contacto/), 'vendedor1@example.com')
    await user.type(screen.getByLabelText('Contraseña'), 'Secreta123')
    await user.selectOptions(screen.getByLabelText('Roles'), 'vendedor')
    await user.selectOptions(screen.getByLabelText('Proveedor asignado'), 'prov1')
    await user.click(screen.getByRole('button', { name: 'Crear usuario' }))

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalled())
    expect(mocks.invoke).toHaveBeenCalledWith('admin-users', {
      body: {
        email: 'vendedor1@showroom.local',
        nombre: 'Vendedor Uno',
        password: 'Secreta123',
      },
    })

    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('asignar_proveedor', {
        p_user: 'user-1',
        p_proveedor: 'prov1',
      }),
    )

    const insert = mocks.from.mock.results
      .map((result) => result.value)
      .find((query) => query.insert.mock.calls.length > 0)
    expect(insert).toBeDefined()
    expect(insert.insert).toHaveBeenCalledWith({ user_id: 'user-1', rol: 'vendedor' })
  })
})
