'use client'

/**
 * AGENT-001 W2: the AI reply agent's mode and knobs (setup page, admins only;
 * the API enforces it too, R7). Mode, knowledge and instructions are always
 * visible; every other knob sits in a collapsed "Advanced" section. The
 * disclosure line can be reworded but not removed: a blank one is restored to
 * the default by the server.
 */
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AGENT_NUMBER_KNOBS,
  useAgentSettings,
  type AgentNumberKnob,
  type AgentSettingsForm,
  type SaveAgentSettingsOutcome,
} from '@/hooks/use-agent-settings'
import {
  AGENT_MODES,
  AGENT_NUMBER_RANGES,
  AGENT_TOOL_NAMES,
  INSTRUCTIONS_MAX_CHARS,
  KNOWLEDGE_MAX_CHARS,
  DISCLOSURE_MAX_CHARS,
  type AgentConfig,
} from '@/domain/value-objects/agent-config'

const TEXTAREA =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

type Update = <K extends keyof AgentSettingsForm>(key: K, value: AgentSettingsForm[K]) => void

function ModePicker({ form, update }: { form: AgentSettingsForm; update: Update }) {
  const t = useTranslations('agentSettings')
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">{t('modeLabel')}</legend>
      {AGENT_MODES.map((mode) => (
        <label key={mode} className="flex items-start gap-2 text-sm">
          <input type="radio" name="agent-mode" value={mode} checked={form.mode === mode} onChange={() => update('mode', mode)}
            className="mt-1" data-testid={`agent-settings-mode-${mode}`} />
          <span><span className="font-medium">{t(`mode.${mode}`)}</span> <span className="text-muted-foreground">{t(`modeHint.${mode}`)}</span></span>
        </label>
      ))}
    </fieldset>
  )
}

function CountedText(props: {
  id: 'knowledge' | 'instructions'
  max: number
  rows: number
  form: AgentSettingsForm
  update: Update
}) {
  const t = useTranslations('agentSettings')
  const value = props.form[props.id]
  return (
    <div className="space-y-1.5">
      <label htmlFor={`agent-settings-${props.id}`} className="text-sm font-medium">{t(`${props.id}Label`)}</label>
      <p className="text-xs text-muted-foreground">{t(`${props.id}Hint`)}</p>
      <textarea id={`agent-settings-${props.id}`} rows={props.rows} maxLength={props.max} value={value} className={TEXTAREA}
        onChange={(e) => props.update(props.id, e.target.value)} data-testid={`agent-settings-${props.id}`} />
      <p data-testid={`agent-settings-${props.id}-count`} className="text-right text-xs text-muted-foreground">
        {t('charCount', { count: value.length, max: props.max })}
      </p>
    </div>
  )
}

function NumberKnob({ knob, value, onChange }: { knob: AgentNumberKnob; value: string; onChange: (v: string) => void }) {
  const t = useTranslations('agentSettings')
  const range = AGENT_NUMBER_RANGES[knob]
  return (
    <div className="space-y-1">
      <label htmlFor={`agent-settings-${knob}`} className="block text-sm font-medium">{t(`knob.${knob}`)}</label>
      <Input id={`agent-settings-${knob}`} type="number" min={range.min} max={range.max} step={range.integer ? 1 : 0.1}
        className="w-32" value={value} onChange={(e) => onChange(e.target.value)} data-testid={`agent-settings-${knob}`} />
      <p className="text-xs text-muted-foreground">{t('range', { min: range.min, max: range.max })}</p>
    </div>
  )
}

function AdvancedKnobs(props: ReturnType<typeof useAgentSettings>) {
  const t = useTranslations('agentSettings')
  const { form, update, updateNumber, toggleTool } = props
  return (
    <details className="rounded-md border border-border p-4" data-testid="agent-settings-advanced">
      <summary className="cursor-pointer text-sm font-medium" data-testid="agent-settings-advanced-toggle">{t('advanced')}</summary>
      <div className="mt-4 space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="agent-settings-disclosure" className="text-sm font-medium">{t('disclosureLabel')}</label>
          <textarea id="agent-settings-disclosure" rows={2} maxLength={DISCLOSURE_MAX_CHARS} value={form.disclosureText} className={TEXTAREA}
            onChange={(e) => update('disclosureText', e.target.value)} data-testid="agent-settings-disclosure" />
          <p className="text-xs text-muted-foreground">{t('disclosureHint')}</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="agent-settings-model" className="block text-sm font-medium">{t('modelLabel')}</label>
          <Input id="agent-settings-model" className="max-w-xs" placeholder={t('modelPlaceholder')} value={form.model}
            onChange={(e) => update('model', e.target.value)} data-testid="agent-settings-model" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="agent-settings-fallback-model" className="block text-sm font-medium">{t('fallbackModelLabel')}</label>
          <Input id="agent-settings-fallback-model" className="max-w-xs" placeholder={t('fallbackModelPlaceholder')} value={form.fallbackModel}
            onChange={(e) => update('fallbackModel', e.target.value)} data-testid="agent-settings-fallback-model" />
          <p className="text-xs text-muted-foreground">{t('fallbackModelHint')}</p>
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">{t('toolsLabel')}</legend>
          {AGENT_TOOL_NAMES.map((name) => (
            <label key={name} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={form.enabledTools.includes(name)}
                onChange={(e) => toggleTool(name, e.target.checked)} data-testid={`agent-settings-tool-${name}`} />
              <span><span className="font-medium">{t(`tool.${name}`)}</span> <span className="text-muted-foreground">{t(`toolHint.${name}`)}</span></span>
            </label>
          ))}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          {AGENT_NUMBER_KNOBS.map((knob) => (
            <NumberKnob key={knob} knob={knob} value={form.numbers[knob]} onChange={(v) => updateNumber(knob, v)} />
          ))}
        </div>
      </div>
    </details>
  )
}

export function SaveFeedback({ outcome }: { outcome: SaveAgentSettingsOutcome | null }) {
  const t = useTranslations('agentSettings')
  if (!outcome) return null
  if (outcome.kind === 'saved') {
    return (
      <div role="status" className="space-y-0.5">
        <p data-testid="agent-settings-saved" className="text-xs text-muted-foreground">{t('saved')}</p>
        {outcome.adjusted.length > 0 ? (
          <p data-testid="agent-settings-adjusted" className="text-xs text-muted-foreground">
            {t('adjusted', { fields: outcome.adjusted.map((f) => t(`field.${f}`)).join(', ') })}
          </p>
        ) : null}
      </div>
    )
  }
  if (outcome.kind === 'stale') {
    return (
      <div role="alert" className="flex items-center gap-2">
        <p data-testid="agent-settings-stale" className="text-xs text-destructive">{t('stale')}</p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()} data-testid="agent-settings-reload">{t('reload')}</Button>
      </div>
    )
  }
  return (
    <p data-testid="agent-settings-error" role="alert" className="text-xs text-destructive">
      {t(outcome.kind === 'forbidden' ? 'forbidden' : 'saveFailed')}
    </p>
  )
}

export function AgentSettingsSection({ initial }: { initial: { config: AgentConfig; rev: number } | null }) {
  const t = useTranslations('agentSettings')
  if (!initial) {
    return (
      <Card data-testid="agent-settings-section">
        <CardHeader><CardTitle>{t('title')}</CardTitle></CardHeader>
        <CardContent>
          <p data-testid="agent-settings-load-error" role="alert" className="text-sm text-destructive">{t('loadFailed')}</p>
        </CardContent>
      </Card>
    )
  }
  return <AgentSettingsCard initial={initial} />
}

function AgentSettingsCard({ initial }: { initial: { config: AgentConfig; rev: number } }) {
  const t = useTranslations('agentSettings')
  const settings = useAgentSettings(initial.config, initial.rev)
  const { form, update, save, saving, outcome } = settings
  return (
    <Card data-testid="agent-settings-section">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <ModePicker form={form} update={update} />
        <CountedText id="knowledge" max={KNOWLEDGE_MAX_CHARS} rows={8} form={form} update={update} />
        <CountedText id="instructions" max={INSTRUCTIONS_MAX_CHARS} rows={4} form={form} update={update} />
        <AdvancedKnobs {...settings} />
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={saving} data-testid="agent-settings-save">{saving ? t('saving') : t('save')}</Button>
          <SaveFeedback outcome={outcome} />
        </div>
      </CardContent>
    </Card>
  )
}
