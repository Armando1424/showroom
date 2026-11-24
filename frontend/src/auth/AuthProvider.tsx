import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { EMAIL_HASH_TO_USERNAME } from './email-map'
import type { Profile, Rol } from '../types'

interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  roles: Rol[]
  loading: boolean
  profileLoading: boolean
  isAdmin: boolean
  isProveedor: boolean
  isVendedor: boolean
  signIn: (identifier: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [roles, setRoles] = useState<Rol[]>([])
  const [loading, setLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(false)

  const loadProfile = useCallback(async (userId: string) => {
    setProfileLoading(true)

    // El trigger de auth.users puede tardar unos milisegundos.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()

      if (!error && data) {
        const { data: roleRows } = await supabase
          .from('user_roles')
          .select('rol')
          .eq('user_id', userId)

        setProfile(data as Profile)
        setRoles(((roleRows ?? []) as { rol: Rol }[]).map((row) => row.rol))
        setProfileLoading(false)
        return
      }

      await sleep(400)
    }

    setProfile(null)
    setRoles([])
    setProfileLoading(false)
  }, [])

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return
      setSession(data.session)
      if (data.session) await loadProfile(data.session.user.id)
      if (mounted) setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession)
        if (newSession) {
          // Evita llamar a Supabase dentro del callback de auth.
          setTimeout(() => {
            void loadProfile(newSession.user.id)
          }, 0)
        } else {
          setProfile(null)
          setRoles([])
          setProfileLoading(false)
        }
      },
    )

    return () => {
      mounted = false
      subscription.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = useCallback(async (identifier: string, password: string) => {
    const id = identifier.trim().toLowerCase()
    if (!id || !password) {
      return { error: 'Escribe tu usuario o correo y tu contraseña.' }
    }

    // Login por usuario o por correo registrado. Supabase Auth usa el correo
    // interno <usuario>@showroom.local; el correo real vive en profiles.email
    // y se resuelve con un mapa de hashes (sin exponerlo en el bundle).
    let email = `${id}@showroom.local`
    if (id.includes('@')) {
      const username = EMAIL_HASH_TO_USERNAME[await sha256Hex(id)]
      if (!username) {
        return { error: 'Ese correo no está habilitado para login. Usa tu usuario.' }
      }
      email = `${username}@showroom.local`
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (!error) return { error: null }

    return {
      error:
        error.message === 'Invalid login credentials'
          ? 'Usuario o contraseña incorrectos.'
          : error.message,
    }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
    setRoles([])
  }, [])

  const refresh = useCallback(async () => {
    if (session) await loadProfile(session.user.id)
  }, [session, loadProfile])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      roles,
      loading,
      profileLoading,
      isAdmin: roles.includes('admin'),
      isProveedor: roles.includes('proveedor'),
      isVendedor: roles.includes('vendedor'),
      signIn,
      signOut,
      refresh,
    }),
    [session, profile, roles, loading, profileLoading, signIn, signOut, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return context
}
