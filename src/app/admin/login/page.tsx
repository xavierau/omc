'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoginForm } from '@/components/auth/login-form'
import { createAuthBrowserClient } from '@/infrastructure/supabase/auth-client'

export default function AdminLoginPage() {
  const router = useRouter()
  const t = useTranslations('adminLogin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (!email || !password) {
      setError(t('errorRequired'))
      setLoading(false)
      return
    }

    try {
      const supabase = createAuthBrowserClient()
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (authError || !data.user) {
        setError(t('errorInvalid'))
        setLoading(false)
        return
      }

      const { data: admin } = await supabase
        .from('platform_admins')
        .select('id')
        .eq('user_id', data.user.id)
        .single()

      if (!admin) {
        await supabase.auth.signOut()
        setError(t('notAuthorized'))
        setLoading(false)
        return
      }

      router.push('/admin')
    } catch {
      setError(t('errorInvalid'))
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-[480px]">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">{t('title')}</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
        </CardHeader>
        <CardContent>
          <LoginForm
            email={email}
            password={password}
            error={error}
            loading={loading}
            labels={{
              email: t('email'),
              emailPlaceholder: t('emailPlaceholder'),
              password: t('password'),
              passwordPlaceholder: t('passwordPlaceholder'),
              signIn: t('signIn'),
              signingIn: t('signingIn'),
            }}
            onEmailChange={setEmail}
            onPasswordChange={setPassword}
            onSubmit={handleSubmit}
          />
        </CardContent>
      </Card>
    </div>
  )
}
