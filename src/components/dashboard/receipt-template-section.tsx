'use client'

import { useCallback, useState } from 'react'
import { ReceiptTemplateStatus } from '@/components/dashboard/receipt-template-status'
import { ReceiptTemplateUploader } from '@/components/dashboard/receipt-template-uploader'

export function ReceiptTemplateSection() {
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => {
    setRefreshKey(k => k + 1)
  }, [])

  return (
    <div className="space-y-4">
      <ReceiptTemplateStatus refreshKey={refreshKey} onRebuild={refresh} />
      <ReceiptTemplateUploader onSuccess={refresh} />
    </div>
  )
}
