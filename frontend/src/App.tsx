import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth, RequireRole } from './auth/RequireAuth'
import { Layout } from './components/Layout'
import { Login } from './pages/Login'
import { Productos } from './pages/Productos'
import { ProductoFormPage } from './pages/ProductoFormPage'
import { Visibilidad } from './pages/Visibilidad'
import { AdminUsuarios } from './pages/AdminUsuarios'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Productos />} />

          <Route
            path="nuevo"
            element={
              <RequireRole roles={['admin', 'proveedor']}>
                <ProductoFormPage />
              </RequireRole>
            }
          />

          <Route path="productos/:id/editar" element={<ProductoFormPage />} />
          <Route path="productos/:id/visibilidad" element={<Visibilidad />} />

          <Route
            path="admin/usuarios"
            element={
              <RequireRole roles={['admin']}>
                <AdminUsuarios />
              </RequireRole>
            }
          />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
