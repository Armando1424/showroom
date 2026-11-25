import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminUsuarios } from '../src/pages/AdminUsuarios'
import { makeQuery } from './helpers'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
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
  useProveedor: () => ({ proveedores: [] }),
}))

describe('AdminUsuarios.crearUsuario', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.from.mockReset()
    mocks.rpc.mockReset()
    mocks.invoke.mockResolvedValue({ data: { user_id: 'user-1' }, error: null })
    mocks.rpc.mockResolvedValue({ error: null })
    mocks.from.mockImplementation(() => makeQuery({ data: [], error: null }))
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
})
