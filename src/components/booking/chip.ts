/** BOOK-009: the selectable chip look of the booking page (party, day, slot): outlined, primary when chosen. */
import { cn } from '@/lib/utils'

export function chipClass(selected: boolean): string {
  return cn(
    'inline-flex items-center justify-center rounded-lg border text-sm font-medium tabular-nums transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed',
    selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:border-primary/60'
  )
}
