'use client'

import { Input } from '@/components/ui/input'
import { applyTemplateButtonChange, createTemplateButton } from './wa-template-form-types'
import type { TemplateButton, WaTemplateFormState } from './wa-template-form-types'

const selectClass = 'h-8 w-full rounded-md border border-input bg-background px-3 text-sm'

type OnChange = (key: keyof WaTemplateFormState, value: unknown) => void

export function WaTemplateButtonsSection({ buttons, onChange }: { buttons: TemplateButton[]; onChange: OnChange }) {
  const addButton = () => {
    if (buttons.length >= 3) return
    onChange('buttons', [...buttons, createTemplateButton()])
  }
  const updateButton = (i: number, key: keyof TemplateButton, value: string) => {
    const next = buttons.map((b, idx) => idx === i ? applyTemplateButtonChange(b, key, value) : b)
    onChange('buttons', next)
  }
  const removeButton = (i: number) => {
    onChange('buttons', buttons.filter((_, idx) => idx !== i))
  }

  return (
    <fieldset className="space-y-3 border border-input rounded-lg p-3">
      <legend className="text-sm font-medium px-1">Buttons (optional, max 3)</legend>
      {buttons.map((btn, i) => (
        <ButtonRow key={i} btn={btn} index={i} onUpdate={updateButton} onRemove={removeButton} />
      ))}
      {buttons.length < 3 && (
        <button type="button" onClick={addButton} className="text-sm text-primary hover:underline">
          + Add button
        </button>
      )}
    </fieldset>
  )
}

function ButtonRow({ btn, index, onUpdate, onRemove }: {
  btn: TemplateButton; index: number
  onUpdate: (i: number, key: keyof TemplateButton, v: string) => void
  onRemove: (i: number) => void
}) {
  // Types this form has no editor for (e.g. COPY_CODE) round-trip read-only
  // rather than risk silently rewriting a button Meta already accepted (#132).
  if (btn.type === 'UNSUPPORTED') {
    return (
      <div className="space-y-2 rounded-md border border-muted p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {(btn.raw?.type as string | undefined) ?? 'Unknown'} button{btn.text ? `: ${btn.text}` : ''}
          </span>
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="text-sm text-destructive hover:underline shrink-0"
          >
            Remove
          </button>
        </div>
        <p data-testid="unsupported-button-notice" className="text-xs text-muted-foreground">
          This button type can&apos;t be edited here
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-md border border-muted p-2">
      <div className="flex items-center justify-between gap-2">
        <select
          value={btn.type}
          onChange={(e) => onUpdate(index, 'type', e.target.value)}
          className={selectClass + ' w-36'}
        >
          <option value="URL">URL</option>
          <option value="PHONE_NUMBER">Phone</option>
          <option value="COUPON_URL">Coupon Link</option>
          <option value="QUICK_REPLY">Quick reply</option>
        </select>
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="text-sm text-destructive hover:underline shrink-0"
        >
          Remove
        </button>
      </div>
      <Labeled label={`Button ${index + 1} label`}>
        <Input
          value={btn.text}
          onChange={(e) => onUpdate(index, 'text', e.target.value)}
          placeholder="Button label"
        />
      </Labeled>
      {btn.type === 'URL' && (
        <Labeled label="Link URL">
          <Input
            value={btn.url}
            onChange={(e) => onUpdate(index, 'url', e.target.value)}
            placeholder="https://..."
          />
        </Labeled>
      )}
      {btn.type === 'PHONE_NUMBER' && (
        <Labeled label="Phone number, with country code">
          <Input
            value={btn.phoneNumber ?? ''}
            onChange={(e) => onUpdate(index, 'phoneNumber', e.target.value)}
            placeholder="+852 1234 5678"
          />
        </Labeled>
      )}
      {btn.type === 'COUPON_URL' && (
        <p className="text-xs text-muted-foreground">
          Links to the coupon page for each member
        </p>
      )}
      {btn.type === 'QUICK_REPLY' && (
        <p data-testid="quick-reply-hint" className="text-xs text-muted-foreground">
          Customers tap to reply. Any campaign using this template switches to
          claim mode: the coupon and QR are sent only after the tap
        </p>
      )}
    </div>
  )
}

// Two bare inputs is what let a phone number land in the label box (#97).
function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground mb-1 block">{label}</span>
      {children}
    </label>
  )
}
