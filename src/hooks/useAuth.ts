import { useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { getSupabase, isSupabaseConfigured } from '../lib/supabase'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured())
  const [passwordRecovery, setPasswordRecovery] = useState(false)

  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true)
      }
      if (event === 'SIGNED_OUT') {
        setPasswordRecovery(false)
      }
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getSupabase()
    if (!supabase) throw new Error('Supabase nie jest skonfigurowany.')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signUp = useCallback(async (email: string, password: string) => {
    const supabase = getSupabase()
    if (!supabase) throw new Error('Supabase nie jest skonfigurowany.')
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
  }, [])

  const resetPassword = useCallback(async (email: string) => {
    const supabase = getSupabase()
    if (!supabase) throw new Error('Supabase nie jest skonfigurowany.')
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/`,
    })
    if (error) throw error
  }, [])

  const updatePassword = useCallback(async (password: string) => {
    const supabase = getSupabase()
    if (!supabase) throw new Error('Supabase nie jest skonfigurowany.')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
    setPasswordRecovery(false)
  }, [])

  const clearPasswordRecovery = useCallback(() => {
    setPasswordRecovery(false)
  }, [])

  const signOut = useCallback(async () => {
    const supabase = getSupabase()
    if (!supabase) return
    setPasswordRecovery(false)
    await supabase.auth.signOut()
  }, [])

  return {
    user,
    loading,
    configured: isSupabaseConfigured(),
    passwordRecovery,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updatePassword,
    clearPasswordRecovery,
  }
}
