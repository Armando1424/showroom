export type Rol = 'admin' | 'proveedor' | 'vendedor'

export type MetodoPago = 'efectivo' | 'tarjeta'

export interface Profile {
  id: string
  nombre: string
  email: string | null
  activo: boolean
  proveedor_id: string | null
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
  imagen_path: string
  proveedor_id: string | null
  metodo_pago: MetodoPago | null
  precio_venta: number | null
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

export interface VentaDetalle {
  venta_id: string
  fecha: string
  producto: string
  vendedor: string
  metodo_pago: MetodoPago
  monto: number
  devuelta: boolean
}

export interface ResumenPeriodo {
  periodo: string
  num_ventas: number
  total_efectivo: number
  total_tarjeta: number
  total_general: number
}

export interface ResumenVendedor {
  vendedor_id: string
  nombre: string
  num_ventas: number
  total_efectivo: number
  total_tarjeta: number
  total_general: number
}
