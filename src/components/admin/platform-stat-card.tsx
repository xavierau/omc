import { Card, CardContent } from '@/components/ui/card'

interface PlatformStatCardProps {
  value: string | number
  label: string
  subtitle?: string
}

export function PlatformStatCard({ value, label, subtitle }: PlatformStatCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <p className="text-[32px] font-bold leading-none text-foreground">{value}</p>
        <p className="text-sm text-muted-foreground mt-2">{label}</p>
        {subtitle && (
          <p className="text-xs text-muted-foreground/70 mt-1">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  )
}
