'use client'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface LoginFormProps {
  email: string
  password: string
  error: string
  loading: boolean
  labels: {
    email: string
    emailPlaceholder: string
    password: string
    passwordPlaceholder: string
    signIn: string
    signingIn: string
  }
  onEmailChange: (v: string) => void
  onPasswordChange: (v: string) => void
  onSubmit: (e: React.FormEvent) => void
}

export function LoginForm({
  email, password, error, loading, labels,
  onEmailChange, onPasswordChange, onSubmit,
}: LoginFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium">
          {labels.email}
        </label>
        <Input id="email" type="email" placeholder={labels.emailPlaceholder}
          value={email} onChange={(e) => onEmailChange(e.target.value)}
          autoComplete="email" />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium">
          {labels.password}
        </label>
        <Input id="password" type="password" placeholder={labels.passwordPlaceholder}
          value={password} onChange={(e) => onPasswordChange(e.target.value)}
          autoComplete="current-password" />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? labels.signingIn : labels.signIn}
      </Button>
    </form>
  )
}
