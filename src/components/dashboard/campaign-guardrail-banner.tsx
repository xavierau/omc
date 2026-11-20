'use client'

import type { GuardrailStatus } from '@/hooks/use-campaign-guardrails'

export function CampaignGuardrailBanner({ guardrails }: { guardrails: GuardrailStatus }) {
  const { violations, warnings, usage } = guardrails

  return (
    <div className="space-y-3">
      {violations.length > 0 && <ViolationBanner violations={violations} />}
      {warnings.length > 0 && <WarningBanner warnings={warnings} />}
      <UsageStats usage={usage} />
    </div>
  )
}

function ViolationBanner({ violations }: { violations: string[] }) {
  return (
    <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
      <p className="font-semibold mb-1">Campaign sending is currently blocked</p>
      <ul className="list-disc list-inside space-y-0.5">
        {violations.map((v) => (
          <li key={v}>{v}</li>
        ))}
      </ul>
    </div>
  )
}

function WarningBanner({ warnings }: { warnings: string[] }) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
      <ul className="list-disc list-inside space-y-0.5">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  )
}

function UsageStats({ usage }: { usage: GuardrailStatus['usage'] }) {
  return (
    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
      <span>
        Monthly: {usage.monthlySends} / {usage.monthlyLimit} sends
      </span>
      <span>
        Daily: {usage.dailyCampaigns} / {usage.dailyLimit} campaigns
      </span>
    </div>
  )
}
