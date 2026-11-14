import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types'

const STORAGE_KEY = 'showroom.proveedor'

interface ProveedorContextValue {
  /** Proveedor sobre el que se opera (admin lo elige; los demás lo tienen fijo). */
  proveedorId: string | null
  proveedores: Profile[]
  loading: boolean
  setProveedorId: (id: string | null) => void
  /** El admin debe elegir un proveedor antes de ver productos o dinero. */
  requiereSeleccion: boolean
}

const ProveedorContext = createContext<ProveedorContextValue | undefined>(undefined)

export function ProveedorProvider({ children }: { children: ReactNode }) {
  const { profile, roles, isAdmin, isProveedor } = useAuth()
  const [proveedores, setProveedores] = useState<Profile[]>([])
  const [seleccionado, setSeleccionado] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(false)

  // El admin necesita la lista para el selector.
  useEffect(() => {
    if (!isAdmin) return
    let active = true

    void (async () => {
      setLoading(true)
      const { data: roleRows } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('rol', 'proveedor')

      const ids = (roleRows ?? []).map((row) => row.user_id as string)
      if (ids.length === 0) {
        if (active) {
          setProveedores([])
          setLoading(false)
        }
        return
      }

      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', ids)
        .eq('activo', true)
        .order('nombre')

      if (active) {
        setProveedores((profiles ?? []) as Profile[])
        setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [isAdmin])

  const setProveedorId = useCallback((id: string | null) => {
    setSeleccionado(id)
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id)
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      // localStorage puede estar bloqueado; la selección vive solo en memoria.
    }
  }, [])

  // Proveedor efectivo: el propio si es proveedor; el asignado si es vendedor.
  const proveedorEfectivo = useMemo(() => {
    if (isAdmin) return seleccionado
    if (isProveedor) return profile?.id ?? null
    return profile?.proveedor_id ?? null
  }, [isAdmin, isProveedor, profile, seleccionado])

  const value = useMemo<ProveedorContextValue>(
    () => ({
      proveedorId: proveedorEfectivo,
      proveedores,
      loading,
      setProveedorId,
      requiereSeleccion: isAdmin && !proveedorEfectivo,
    }),
    [proveedorEfectivo, proveedores, loading, setProveedorId, isAdmin, roles],
  )

  return <ProveedorContext.Provider value={value}>{children}</ProveedorContext.Provider>
}

export function useProveedor(): ProveedorContextValue {
  const context = useContext(ProveedorContext)
  if (!context) throw new Error('useProveedor debe usarse dentro de ProveedorProvider')
  return context
}
