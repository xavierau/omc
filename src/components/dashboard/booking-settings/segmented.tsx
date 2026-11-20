/**
 * BOOK-009 S1: a segmented choice (interval, table time). A radiogroup of
 * buttons; the chosen one is raised, as in the A1 mockup.
 */
import { cn } from '@/lib/utils'

export interface SegmentedOption<T> {
  value: T
  label: string
}

export interface SegmentedProps<T> {
  label: string
  value: T
  options: SegmentedOption<T>[]
  onChange: (value: T) => void
  testId: string
}

export function Segmented<T extends string | number | null>({ label, value, options, onChange, testId }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} data-testid={testId} className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1">
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
          data-testid={`${testId}-${o.value ?? 'none'}`}
          className={cn('h-8 rounded-md px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            o.value === value ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
