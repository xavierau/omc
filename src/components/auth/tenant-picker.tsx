'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface Tenant {
  id: string
  name: string
  slug: string
  role: string
}

interface TenantPickerProps {
  tenants: Tenant[]
  label: string
  buttonLabel: string
  onSelect: (id: string) => void
}

export function TenantPicker({
  tenants, label, buttonLabel, onSelect,
}: TenantPickerProps) {
  const [selected, setSelected] = useState(tenants[0]?.id ?? '')

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-[480px]">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">{label}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {tenants.map((t) => (
            <button key={t.id} type="button"
              onClick={() => setSelected(t.id)}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${
                selected === t.id
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}>
              <p className="font-medium">{t.name}</p>
              <p className="text-sm text-muted-foreground">{t.role}</p>
            </button>
          ))}
          <Button className="w-full" onClick={() => onSelect(selected)}>
            {buttonLabel}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
