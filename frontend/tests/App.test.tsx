import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../src/App'

vi.mock('../src/auth/RequireAuth', async () => {
  const { Outlet } = await import('react-router-dom')
  return {
    RequireAuth: () => <Outlet />,
    RequireRole: ({ children }: { children: ReactNode }) => <>{children}</>,
  }
})

vi.mock('../src/components/Layout', async () => {
  const { Outlet } = await import('react-router-dom')
  return { Layout: () => <Outlet /> }
})

vi.mock('../src/pages/Login', () => ({ Login: () => <div>login-page</div> }))
vi.mock('../src/pages/Productos', () => ({ Productos: () => <div>productos-page</div> }))
vi.mock('../src/pages/Dinero', () => ({ Dinero: () => <div>dinero-page</div> }))
vi.mock('../src/pages/ProductoFormPage', () => ({
  ProductoFormPage: () => <div>form-page</div>,
}))
vi.mock('../src/pages/Visibilidad', () => ({
  Visibilidad: () => <div>visibilidad-page</div>,
}))
vi.mock('../src/pages/AdminUsuarios', () => ({
  AdminUsuarios: () => <div>admin-page</div>,
}))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('App routes', () => {
  it('renderiza el login', () => {
    renderAt('/login')
    expect(screen.getByText('login-page')).toBeInTheDocument()
  })

  it('renderiza productos en la raíz', () => {
    renderAt('/')
    expect(screen.getByText('productos-page')).toBeInTheDocument()
  })

  it('renderiza dinero', () => {
    renderAt('/dinero')
    expect(screen.getByText('dinero-page')).toBeInTheDocument()
  })

  it('renderiza alta y edición de producto', () => {
    renderAt('/nuevo')
    expect(screen.getByText('form-page')).toBeInTheDocument()
  })

  it('renderiza la edición por id', () => {
    renderAt('/productos/p1/editar')
    expect(screen.getByText('form-page')).toBeInTheDocument()
  })

  it('renderiza visibilidad', () => {
    renderAt('/productos/p1/visibilidad')
    expect(screen.getByText('visibilidad-page')).toBeInTheDocument()
  })

  it('renderiza administración de usuarios', () => {
    renderAt('/admin/usuarios')
    expect(screen.getByText('admin-page')).toBeInTheDocument()
  })

  it('redirige una ruta desconocida a productos', async () => {
    renderAt('/ruta-inexistente')
    expect(await screen.findByText('productos-page')).toBeInTheDocument()
  })
})
