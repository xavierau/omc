'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

interface FlaggedReceipt {
  id: string
  total_amount: number | null
  layout_score: number | null
  created_at: string
  member_id: string | null
  members: { phone: string; name: string | null } | null
}

export function FlaggedReceiptsPanel() {
  const t = useTranslations('receiptTemplate')
  const [receipts, setReceipts] = useState<FlaggedReceipt[]>([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<string | null>(null)

  useEffect(() => { fetchFlagged() }, [])

  async function fetchFlagged() {
    setLoading(true)
    try {
      const res = await fetch('/api/dashboard/receipts/flagged')
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setReceipts(data.receipts ?? [])
    } catch {
      setReceipts([])
    } finally {
      setLoading(false)
    }
  }

  async function handleAction(receiptId: string, action: 'approve' | 'reject') {
    setActionId(receiptId)
    try {
      const res = await fetch('/api/dashboard/receipts/flagged', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiptId, action }),
      })
      if (!res.ok) throw new Error('Failed')
      setReceipts(prev => prev.filter(r => r.id !== receiptId))
    } catch {
      // keep in list on failure
    } finally {
      setActionId(null)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          {t('loadingFlagged')}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('flaggedTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        {receipts.length === 0
          ? <p className="text-sm text-muted-foreground py-4 text-center">{t('noFlagged')}</p>
          : <ReceiptsTable receipts={receipts} actionId={actionId} onAction={handleAction} t={t} />
        }
      </CardContent>
    </Card>
  )
}

function ReceiptsTable({ receipts, actionId, onAction, t }: {
  receipts: FlaggedReceipt[]
  actionId: string | null
  onAction: (id: string, action: 'approve' | 'reject') => void
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('colDate')}</TableHead>
          <TableHead>{t('colMember')}</TableHead>
          <TableHead>{t('colAmount')}</TableHead>
          <TableHead>{t('colLayoutScore')}</TableHead>
          <TableHead>{t('colActions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {receipts.map(r => (
          <ReceiptRow key={r.id} receipt={r} busy={actionId === r.id} onAction={onAction} t={t} />
        ))}
      </TableBody>
    </Table>
  )
}

function ReceiptRow({ receipt, busy, onAction, t }: {
  receipt: FlaggedReceipt
  busy: boolean
  onAction: (id: string, action: 'approve' | 'reject') => void
  t: ReturnType<typeof useTranslations>
}) {
  const memberLabel = receipt.members?.name ?? receipt.members?.phone ?? t('colMember')
  const score = receipt.layout_score
  const scoreBadge = score != null && score < 0.5 ? 'destructive' : 'secondary'

  return (
    <TableRow>
      <TableCell>{new Date(receipt.created_at).toLocaleDateString()}</TableCell>
      <TableCell>{memberLabel}</TableCell>
      <TableCell>{receipt.total_amount != null ? `HK$${receipt.total_amount}` : '-'}</TableCell>
      <TableCell><Badge variant={scoreBadge}>{score?.toFixed(2) ?? 'N/A'}</Badge></TableCell>
      <TableCell className="flex gap-1">
        <Button size="xs" onClick={() => onAction(receipt.id, 'approve')} disabled={busy}>
          {t('approve')}
        </Button>
        <Button size="xs" variant="destructive" onClick={() => onAction(receipt.id, 'reject')} disabled={busy}>
          {t('reject')}
        </Button>
      </TableCell>
    </TableRow>
  )
}
