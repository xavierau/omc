import { Card, CardContent } from '@/components/ui/card'

interface StatCardProps {
  value: string | number
  label: string
}

export function StatCard({ value, label }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <p className="text-[32px] font-bold leading-none text-foreground">{value}</p>
        <p className="text-sm text-muted-foreground mt-2">{label}</p>
      </CardContent>
    </Card>
  )
}
