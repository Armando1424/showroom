import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider, useAuth } from '../src/auth/AuthProvider'
import type { Profile, Rol } from '../src/types'
import { makeQuery } from './helpers'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  from: vi.fn(),
  profile: null as Profile | null,
  roles: [] as { rol: Rol }[],
  callback: null as ((event: string, session: unknown) => void) | null,
}))

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
    },
    from: mocks.from,
  },
}))

const perfil: Profile = {
  id: 'u1',
  nombre: 'Administrador',
  email: 'admin@example.com',
  activo: true,
  proveedor_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function Consumer() {
  const {
    session,
    profile,
    roles,
    loading,
    profileLoading,
    isAdmin,
    signIn,
    signOut,
    refresh,
  } = useAuth()
  const [result, setResult] = useState('idle')

  async function doSignIn(identifier: string, password: string) {
    const response = await signIn(identifier, password)
    setResult(response.error ?? 'ok')
  }

  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="profile-loading">{String(profileLoading)}</span>
      <span data-testid="session">{session?.user.id ?? 'none'}</span>
      <span data-testid="profile">{profile?.nombre ?? 'none'}</span>
      <span data-testid="roles">{roles.join(',')}</span>
      <span data-testid="admin">{String(isAdmin)}</span>
      <span data-testid="result">{result}</span>
      <button onClick={() => void doSignIn('WILL', 'Will123')}>signin-user</button>
      <button onClick={() => void doSignIn('noexiste@example.com', 'x')}>signin-email</button>
      <button onClick={() => void signOut()}>signout</button>
      <button onClick={() => void refresh()}>refresh</button>
    </div>
  )
}

describe('AuthProvider', () => {
  beforeEach(() => {
    mocks.getSession.mockResolvedValue({ data: { session: null } })
    mocks.onAuthStateChange.mockImplementation((callback: typeof mocks.callback) => {
      mocks.callback = callback
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })
    mocks.signInWithPassword.mockResolvedValue({ error: null })
    mocks.signOut.mockResolvedValue({ error: null })
    mocks.profile = perfil
    mocks.roles = [{ rol: 'admin' }]
    mocks.from.mockImplementation((table: string) =>
      makeQuery({
        data:
          table === 'profiles'
            ? mocks.profile
            : table === 'user_roles'
              ? mocks.roles
              : [],
        error: null,
      }),
    )
  })

  it('inicia sesión con username y lo mapea al correo interno', async () => {
    const user = userEvent.setup()
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    await user.click(screen.getByRole('button', { name: 'signin-user' }))

    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: 'will@showroom.local',
      password: 'Will123',
    })
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('ok'))
  })

  it('rechaza un correo que no está en el mapa', async () => {
    const user = userEvent.setup()
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    await user.click(screen.getByRole('button', { name: 'signin-email' }))

    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByTestId('result')).toHaveTextContent(
        'Ese correo no está habilitado para login. Usa tu usuario.',
      ),
    )
  })

  it('traduce credenciales inválidas', async () => {
    mocks.signInWithPassword.mockResolvedValue({
      error: { message: 'Invalid login credentials' },
    })

    const user = userEvent.setup()
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    await user.click(screen.getByRole('button', { name: 'signin-user' }))

    await waitFor(() =>
      expect(screen.getByTestId('result')).toHaveTextContent(
        'Usuario o contraseña incorrectos.',
      ),
    )
  })

  it('carga perfil y roles con una sesión existente', async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: 'u1' } } },
    })

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('Administrador'))
    expect(screen.getByTestId('session')).toHaveTextContent('u1')
    expect(screen.getByTestId('roles')).toHaveTextContent('admin')
    expect(screen.getByTestId('admin')).toHaveTextContent('true')
    expect(screen.getByTestId('loading')).toHaveTextContent('false')
  })

  it('reacciona a SIGNED_IN y SIGNED_OUT', async () => {
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))

    act(() => mocks.callback?.('SIGNED_IN', { user: { id: 'u1' } }))
    await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('Administrador'))

    act(() => mocks.callback?.('SIGNED_OUT', null))
    await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('none'))
    expect(screen.getByTestId('roles')).toHaveTextContent('')
  })

  it('limpia perfil y roles al cerrar sesión', async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: 'u1' } } },
    })

    const user = userEvent.setup()
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('Administrador'))
    await user.click(screen.getByRole('button', { name: 'signout' }))

    expect(mocks.signOut).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('none'))
    expect(screen.getByTestId('roles')).toHaveTextContent('')
  })
})
