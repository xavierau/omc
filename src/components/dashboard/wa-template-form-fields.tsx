'use client'

import { Input } from '@/components/ui/input'
import { WaTemplateButtonsSection } from './wa-template-buttons-section'
import type { WaTemplateFormState } from './wa-template-form-types'

export type { WaTemplateFormState }
export { initialWaTemplateForm, buildWaTemplateRequestBody } from './wa-template-form-types'

const selectClass = 'h-8 w-full rounded-md border border-input bg-background px-3 text-sm'

type OnChange = (key: keyof WaTemplateFormState, value: unknown) => void

const LANGUAGES: [string, string][] = [
  ['en', 'English'], ['zh_HK', 'Chinese (HK)'], ['zh_CN', 'Chinese (CN)'],
  ['es', 'Spanish'], ['fr', 'French'], ['ja', 'Japanese'],
  ['ko', 'Korean'], ['pt_BR', 'Portuguese (BR)'], ['de', 'German'],
]

function formatName(v: string): string {
  return v.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
}

export function WaTemplateFormFields({ form, onChange }: { form: WaTemplateFormState; onChange: OnChange }) {
  return (
    <div className="space-y-4 mt-4">
      <Field label="Name">
        <Input value={form.name} onChange={(e) => onChange('name', formatName(e.target.value))} placeholder="my_template_name" />
        <p className="text-xs text-muted-foreground mt-1">Lowercase, underscores only</p>
      </Field>
      <Field label="Language">
        <select value={form.language} onChange={(e) => onChange('language', e.target.value)} className={selectClass}>
          {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
      </Field>
      <CategoryField category={form.category} onChange={onChange} />
      <HeaderSection form={form} onChange={onChange} />
      <Field label="Body *">
        <textarea value={form.body} onChange={(e) => onChange('body', e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]"
          placeholder="Hello {{customer_name}}, your code is {{code}}" />
        <p className="text-xs text-muted-foreground mt-1">Variables: {'{{customer_name}}'}, {'{{code}}'}, {'{{discount}}'}</p>
      </Field>
      <Field label="Footer">
        <Input value={form.footer} onChange={(e) => onChange('footer', e.target.value.slice(0, 60))} placeholder="Optional footer (max 60 chars)" maxLength={60} />
      </Field>
      <WaTemplateButtonsSection buttons={form.buttons} onChange={onChange} />
    </div>
  )
}

function CategoryField({ category, onChange }: { category: string; onChange: OnChange }) {
  return (
    <Field label="Category">
      <div className="flex gap-4">
        {['MARKETING', 'UTILITY'].map((c) => (
          <label key={c} className="flex items-center gap-1.5 text-sm">
            <input type="radio" checked={category === c} onChange={() => onChange('category', c)} />
            {c.charAt(0) + c.slice(1).toLowerCase()}
          </label>
        ))}
      </div>
    </Field>
  )
}

function HeaderSection({ form, onChange }: { form: WaTemplateFormState; onChange: OnChange }) {
  return (
    <fieldset className="space-y-3 border border-input rounded-lg p-3">
      <legend className="text-sm font-medium px-1">Header (optional)</legend>
      <select value={form.headerType} onChange={(e) => onChange('headerType', e.target.value)} className={selectClass}>
        <option value="none">None</option>
        <option value="text">Text</option>
        <option value="image">Image</option>
      </select>
      {form.headerType === 'text' && (
        <Input value={form.headerText} onChange={(e) => onChange('headerText', e.target.value)} placeholder="Header text with {{param}}" />
      )}
      {form.headerType === 'image' && (
        <Input value={form.headerImageUrl} onChange={(e) => onChange('headerImageUrl', e.target.value)} placeholder="https://example.com/image.jpg" />
      )}
    </fieldset>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-sm font-medium text-foreground mb-1 block">{label}</label>{children}</div>
}
