import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'

export function Layout() {
  const { profile, roles, signOut } = useAuth()
  const navigate = useNavigate()
  const isAdmin = roles.includes('admin')
  const isProveedor = roles.includes('proveedor')

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          Showroom <span className="badge beta">beta</span>
        </div>
        <nav className="nav">
          <NavLink to="/" end>
            Productos
          </NavLink>
          {(isAdmin || isProveedor) && <NavLink to="/nuevo">Nuevo producto</NavLink>}
          {isAdmin && <NavLink to="/admin/usuarios">Usuarios</NavLink>}
        </nav>
        <div className="user">
          <span className="user-name">{profile?.nombre}</span>
          <span className="badge">{roles.length ? roles.join(', ') : 'sin rol'}</span>
          <button
            className="link"
            onClick={() => {
              void signOut().then(() => navigate('/login'))
            }}
          >
            Salir
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <footer className="app-footer">
        <span className="badge beta">beta</span>
        Versión beta: funciones y datos en prueba. El catálogo puede cambiar
        mientras se valida el flujo completo.
      </footer>
    </div>
  )
}
