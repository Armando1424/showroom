import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useProveedor } from '../proveedor/ProveedorProvider'

export function Layout() {
  const { profile, roles, signOut, isAdmin, isProveedor } = useAuth()
  const { proveedores, proveedorId, setProveedorId, loading } = useProveedor()
  const navigate = useNavigate()

  const puedeVerDinero = roles.includes('admin') || roles.includes('proveedor') || roles.includes('vendedor')

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
          {puedeVerDinero && <NavLink to="/dinero">Dinero</NavLink>}
          <NavLink to="/nuevo" className="nav-add" title="Nuevo producto" aria-label="Nuevo producto">
            +
          </NavLink>
          {isAdmin && <NavLink to="/admin/usuarios">Usuarios</NavLink>}
        </nav>

        <div className="user">
          {isAdmin && (
            <label className="proveedor-picker">
              <span className="muted small">Proveedor</span>
              <select
                value={proveedorId ?? ''}
                onChange={(event) => setProveedorId(event.target.value || null)}
                disabled={loading}
              >
                <option value="">— elegir —</option>
                {proveedores.map((proveedor) => (
                  <option key={proveedor.id} value={proveedor.id}>
                    {proveedor.nombre || proveedor.email || proveedor.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="user-name">{profile?.nombre}</span>
          <span className="badge">{roles.length ? roles.join(', ') : 'sin rol'}</span>
          {!isAdmin && !isProveedor && roles.includes('vendedor') && !profile?.proveedor_id && (
            <span className="badge danger">sin proveedor asignado</span>
          )}
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
