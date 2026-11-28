/** BOOK-009 S1: one titled block of the booking hours settings (A1 mockup). */
export function SettingsBlock({ title, hint, children, testId }: { title: string; hint?: string; children: React.ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} className="space-y-3 border-t border-border pt-5">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

export function HoursFieldError({ message, testId }: { message: string | null; testId: string }) {
  return message ? (
    <p data-testid={testId} role="alert" className="text-xs text-destructive">{message}</p>
  ) : null
}
