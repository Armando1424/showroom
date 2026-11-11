export type Rol = 'admin' | 'proveedor' | 'vendedor'

export interface Profile {
  id: string
  nombre: string
  email: string | null
  activo: boolean
  created_at: string
  updated_at: string
}

export interface UserRole {
  id: string
  user_id: string
  rol: Rol
  granted_by: string
  granted_at: string
}

export interface Producto {
  id: string
  nombre: string
  descripcion: string | null
  precio: number | null
  estado: 'disponible' | 'vendido'
  created_by: string
  updated_by: string | null
  sold_by: string | null
  sold_at: string | null
  deleted_at: string | null
  deleted_by: string | null
  created_at: string
  updated_at: string
}

export interface ProductVisibility {
  id: string
  producto_id: string
  user_id: string | null
  rol: Rol | null
  granted_by: string
  granted_at: string
}
