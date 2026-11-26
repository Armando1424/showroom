import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RequireAuth, RequireRole } from '../src/auth/RequireAuth'

const mocks = vi.hoisted(() => ({
  auth: {
    session: null as { user: { id: string } } | null,
    profile: null as { activo: boolean } | null,
    roles: [] as string[],
    loading: false,
    profileLoading: false,
    signOut: vi.fn(),
    refresh: vi.fn(),
  },
}))

vi.mock('../src/auth/AuthProvider', () => ({
  useAuth: () => mocks.auth,
}))

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/login" element={<div>login</div>} />
        <Route element={<RequireAuth />}>
          <Route index element={<div>contenido</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

function renderRole(roles: string[]) {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/" element={<div>home</div>} />
        <Route
          path="/admin"
          element={
            <RequireRole roles={roles as never}>
              <div>admin</div>
            </RequireRole>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireAuth y RequireRole', () => {
  beforeEach(() => {
    mocks.auth = {
      session: null,
      profile: null,
      roles: [],
      loading: false,
      profileLoading: false,
      signOut: vi.fn(),
      refresh: vi.fn(),
    }
  })

  it('muestra Cargando mientras carga', () => {
    mocks.auth.loading = true
    renderGuard()
    expect(screen.getByText('Cargando…')).toBeInTheDocument()
  })

  it('redirige al login sin sesión', async () => {
    renderGuard()
    expect(await screen.findByText('login')).toBeInTheDocument()
  })

  it('muestra Cargando mientras carga el perfil', () => {
    mocks.auth.session = { user: { id: 'u1' } }
    mocks.auth.profileLoading = true
    renderGuard()
    expect(screen.getByText('Cargando…')).toBeInTheDocument()
  })

  it('muestra perfil no disponible y permite reintentar o salir', async () => {
    mocks.auth.session = { user: { id: 'u1' } }
    mocks.auth.profile = null
    mocks.auth.loading = false
    mocks.auth.profileLoading = false

    const user = userEvent.setup()
    renderGuard()

    expect(await screen.findByText('Perfil no disponible')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    await user.click(screen.getByRole('button', { name: 'Salir' }))
    expect(mocks.auth.refresh).toHaveBeenCalled()
    expect(mocks.auth.signOut).toHaveBeenCalled()
  })

  it('bloquea a un perfil inactivo', async () => {
    mocks.auth.session = { user: { id: 'u1' } }
    mocks.auth.profile = { activo: false }

    const user = userEvent.setup()
    renderGuard()

    expect(await screen.findByText('Cuenta pendiente de activación')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Salir' }))
    expect(mocks.auth.signOut).toHaveBeenCalled()
  })

  it('deja pasar a un perfil activo', async () => {
    mocks.auth.session = { user: { id: 'u1' } }
    mocks.auth.profile = { activo: true }

    renderGuard()

    expect(await screen.findByText('contenido')).toBeInTheDocument()
  })

  it('RequireRole permite el rol y redirige si no lo tiene', async () => {
    mocks.auth.roles = ['admin']
    const { unmount } = renderRole(['admin'])
    expect(await screen.findByText('admin')).toBeInTheDocument()
    unmount()

    mocks.auth.roles = ['vendedor']
    renderRole(['admin'])
    expect(await screen.findByText('home')).toBeInTheDocument()
  })
})
