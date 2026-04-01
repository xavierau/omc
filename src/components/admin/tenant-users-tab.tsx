'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import type { TenantUser } from '@/hooks/use-admin-tenant-detail'

interface TenantUsersTabProps {
  tenantId: string
  users: TenantUser[]
  onMutate: () => void
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-HK', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function TenantUsersTab({ tenantId, users, onMutate }: TenantUsersTabProps) {
  const t = useTranslations('admin')
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowForm(!showForm)}>{t('addUser')}</Button>
      </div>
      {showForm && (
        <AddUserForm tenantId={tenantId} onDone={() => { setShowForm(false); onMutate() }} />
      )}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('email')}</TableHead>
              <TableHead>{t('role')}</TableHead>
              <TableHead>{t('addedAt')}</TableHead>
              <TableHead>{t('actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <UserRow key={user.id} tenantId={tenantId} user={user} onMutate={onMutate} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function UserRow({ tenantId, user, onMutate }: {
  tenantId: string; user: TenantUser; onMutate: () => void
}) {
  const t = useTranslations('admin')
  const [removing, setRemoving] = useState(false)

  async function handleRemove() {
    setRemoving(true)
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/users/${user.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      onMutate()
    } catch {
      alert(t('userRemoveError'))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <TableRow>
      <TableCell>{user.email}</TableCell>
      <TableCell><Badge variant="secondary">{user.role}</Badge></TableCell>
      <TableCell className="text-muted-foreground">{formatDate(user.createdAt)}</TableCell>
      <TableCell>
        <Button variant="destructive" size="xs" disabled={removing} onClick={handleRemove}>
          {t('removeUser')}
        </Button>
      </TableCell>
    </TableRow>
  )
}

function AddUserForm({ tenantId, onDone }: { tenantId: string; onDone: () => void }) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('staff')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, role }),
      })
      if (!res.ok) throw new Error(t('userAddError'))
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('userAddError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end p-4 rounded-md border bg-muted/30">
      {error && <p className="w-full text-sm text-destructive">{error}</p>}
      <div className="space-y-1">
        <label className="text-sm font-medium">{t('email')}</label>
        <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium">{t('password')}</label>
        <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium">{t('role')}</label>
        <select
          value={role}
          onChange={e => setRole(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="admin">{t('roleAdmin')}</option>
          <option value="staff">{t('roleStaff')}</option>
        </select>
      </div>
      <Button type="submit" disabled={submitting} size="sm">
        {submitting ? tc('creating') : t('addUser')}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onDone}>{tc('cancel')}</Button>
    </form>
  )
}
