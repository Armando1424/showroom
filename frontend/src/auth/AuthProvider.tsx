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
import type { Profile, Rol } from '../types'

interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  roles: Rol[]
  loading: boolean
  isAdmin: boolean
  isProveedor: boolean
  isVendedor: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [roles, setRoles] = useState<Rol[]>([])
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId: string) => {
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
        return
      }

      await sleep(400)
    }

    setProfile(null)
    setRoles([])
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
        }
      },
    )

    return () => {
      mounted = false
      subscription.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
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
      isAdmin: roles.includes('admin'),
      isProveedor: roles.includes('proveedor'),
      isVendedor: roles.includes('vendedor'),
      signIn,
      signOut,
      refresh,
    }),
    [session, profile, roles, loading, signIn, signOut, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return context
}
