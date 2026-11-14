import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import { ProveedorProvider } from './proveedor/ProveedorProvider'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <ProveedorProvider>
          <App />
        </ProveedorProvider>
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>,
)
