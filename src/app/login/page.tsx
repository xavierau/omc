'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoginForm } from '@/components/auth/login-form'
import { TenantPicker } from '@/components/auth/tenant-picker'
import { createAuthBrowserClient } from '@/infrastructure/supabase/auth-client'

interface Tenant {
  id: string
  name: string
  slug: string
  role: string
}

export default function LoginPage() {
  const router = useRouter()
  const t = useTranslations('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [showPicker, setShowPicker] = useState(false)

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
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (authError) {
        setError(t('errorInvalid'))
        setLoading(false)
        return
      }

      const res = await fetch('/api/me/tenants')
      if (!res.ok) throw new Error('Failed to fetch tenants')
      const data: Tenant[] = await res.json()

      if (data.length === 0) {
        setError(t('noAccess'))
        setLoading(false)
        return
      }

      if (data.length === 1) {
        selectTenant(data[0].id)
        return
      }

      setTenants(data)
      setShowPicker(true)
      setLoading(false)
    } catch {
      setError(t('errorGeneric'))
      setLoading(false)
    }
  }

  function selectTenant(id: string) {
    document.cookie = `x-tenant-id=${id};path=/;max-age=31536000`
    router.push('/dashboard')
  }

  if (showPicker) {
    return (
      <TenantPicker
        tenants={tenants}
        label={t('selectTenant')}
        buttonLabel={t('continue')}
        onSelect={selectTenant}
      />
    )
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
