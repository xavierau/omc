'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

interface CouponQrDisplayProps {
  code: string
}

export function CouponQrDisplay({ code }: CouponQrDisplayProps) {
  const [dataUrl, setDataUrl] = useState<string>('')

  useEffect(() => {
    QRCode.toDataURL(`REDEEM ${code}`, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(setDataUrl).catch(console.error)
  }, [code])

  if (!dataUrl) {
    return <div className="mx-auto h-[200px] w-[200px] animate-pulse rounded-lg bg-muted" />
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <img src={dataUrl} alt={`QR code for ${code}`} width={200} height={200} className="rounded-lg" />
      <p className="text-xs text-muted-foreground">Show this QR code to staff</p>
    </div>
  )
}
