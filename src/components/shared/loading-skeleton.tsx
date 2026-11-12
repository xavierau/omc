import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'

export function HeroStatSkeleton() {
  return (
    <div className="bg-card rounded-lg shadow-sm p-8">
      <Skeleton className="h-[72px] w-48" />
      <Skeleton className="h-5 w-40 mt-2" />
    </div>
  )
}

export function StatCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-6">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-4 w-32 mt-2" />
      </CardContent>
    </Card>
  )
}

export function MiniFeedSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="w-2 h-2 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  )
}
