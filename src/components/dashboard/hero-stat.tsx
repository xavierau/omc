interface HeroStatProps {
  value: number
  label: string
}

export function HeroStat({ value, label }: HeroStatProps) {
  return (
    <div className="bg-card rounded-lg shadow-sm p-8">
      <p className="text-[72px] font-bold leading-none text-foreground">{value}</p>
      <p className="text-lg text-muted-foreground mt-2">{label}</p>
    </div>
  )
}
