'use client'

/**
 * BOOK-001: the admin booking settings form state and its save call
 * (AC-1/AC-2/AC-3). Lifetimes are edited as hours plus a "no expiry" switch;
 * the payload sends null for no expiry.
 */
import { useState } from 'react'
import {
  BOOKING_RULES_MAX_CHARS,
  isPartyMax,
  isSafeHttpsUrl,
  isTtl,
  type AgentBookingConfig,
  type BookingConfig,
  type BookingMode,
} from '@/domain/value-objects/booking-config'
import type { BookingTemplateStatuses } from '@/domain/services/booking-templates'
import { parseTemplateStatuses } from './use-booking-availability'

export interface BookingSettingsForm {
  mode: BookingMode
  externalUrl: string
  chatLinkTtlHours: string
  chatLinkNoExpiry: boolean
  campaignLinkTtlHours: string
  campaignLinkNoExpiry: boolean
  maxPartySize: string
  /** AGENT-005: 訂座規則, shown unless mode is off. */
  bookingRules: string
}

export type SaveBookingSettingsOutcome =
  | { kind: 'saved'; config: BookingConfig; templates: BookingTemplateStatuses | null }
  | { kind: 'fields'; errors: Record<string, string> }
  | { kind: 'forbidden' }
  | { kind: 'error' }

export function toForm(config: BookingConfig): BookingSettingsForm {
  return {
    mode: config.mode,
    externalUrl: config.externalUrl ?? '',
    chatLinkTtlHours: String(config.chatLinkTtlHours ?? 24),
    chatLinkNoExpiry: config.chatLinkTtlHours === null,
    campaignLinkTtlHours: String(config.campaignLinkTtlHours ?? 168),
    campaignLinkNoExpiry: config.campaignLinkTtlHours === null,
    maxPartySize: String(config.maxPartySize),
    bookingRules: config.bookingRules,
  }
}

const toInt = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value.trim()) : value)

// Only External mode shows (and so can explain an error on) the URL field. Any
// other mode keeps a valid stored URL and drops an invalid draft instead of
// failing the save on an error the admin cannot see.
function externalUrlPayload(form: BookingSettingsForm): string | null {
  const url = form.externalUrl.trim()
  if (url === '') return null
  if (form.mode === 'external') return url
  return isSafeHttpsUrl(url) ? url : null
}

// Same idea for the fields only Simple mode shows (lifetimes, party size):
// outside Simple an invalid draft is left out (undefined is dropped by
// JSON.stringify), so the server keeps the saved value (review F1).
function simpleOnly(form: BookingSettingsForm, value: unknown, valid: (v: unknown) => boolean): unknown {
  return form.mode === 'simple' || valid(value) ? value : undefined
}

const isTtlOrNone = (v: unknown) => v === null || isTtl(v)

export function toPayload(form: BookingSettingsForm): Record<string, unknown> {
  return {
    mode: form.mode,
    externalUrl: externalUrlPayload(form),
    chatLinkTtlHours: simpleOnly(form, form.chatLinkNoExpiry ? null : toInt(form.chatLinkTtlHours), isTtlOrNone),
    campaignLinkTtlHours: simpleOnly(form, form.campaignLinkNoExpiry ? null : toInt(form.campaignLinkTtlHours), isTtlOrNone),
    maxPartySize: simpleOnly(form, toInt(form.maxPartySize), isPartyMax),
    // AGENT-005: Off hides the field, so there an over-long draft is left out (same idea as F1).
    bookingRules: form.mode !== 'off' || form.bookingRules.trim().length <= BOOKING_RULES_MAX_CHARS ? form.bookingRules : undefined,
  }
}

/** Warning state: External link chosen but no URL yet (save stays disabled). */
export function needsExternalUrl(form: BookingSettingsForm): boolean {
  return form.mode === 'external' && form.externalUrl.trim() === ''
}

export function saveOutcome(status: number, body: unknown): SaveBookingSettingsOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as { config?: BookingConfig; fields?: Record<string, string>; templates?: unknown }
  if (status === 200 && b.config) return { kind: 'saved', config: b.config, templates: parseTemplateStatuses(b.templates) }
  if (status === 400 && b.fields) return { kind: 'fields', errors: b.fields }
  if (status === 403) return { kind: 'forbidden' }
  return { kind: 'error' }
}

export async function saveBookingSettings(form: BookingSettingsForm): Promise<SaveBookingSettingsOutcome> {
  try {
    const res = await fetch('/api/dashboard/settings/booking', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toPayload(form)),
    })
    return saveOutcome(res.status, await res.json().catch(() => null))
  } catch {
    return { kind: 'error' }
  }
}

export function useBookingSettings(initial: BookingConfig) {
  const [form, setForm] = useState<BookingSettingsForm>(() => toForm(initial))
  const [outcome, setOutcome] = useState<SaveBookingSettingsOutcome | null>(null)
  const [saving, setSaving] = useState(false)

  function update<K extends keyof BookingSettingsForm>(key: K, value: BookingSettingsForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setOutcome(null)
  }

  async function save() {
    setSaving(true)
    const result = await saveBookingSettings(form)
    if (result.kind === 'saved') setForm(toForm(result.config))
    setOutcome(result)
    setSaving(false)
  }

  return { form, update, save, saving, outcome }
}

/**
 * BOOK-003 (R43): the admin's "Allow AI agents" block. Its own save, so the
 * booking form's Save never touches it and vice versa.
 */
export interface AgentBookingForm {
  enabled: boolean
  websiteHost: string
}

export type AgentBookingOutcome =
  | { kind: 'saved' | 'rotated'; agentBooking: AgentBookingConfig }
  | { kind: 'fields'; errors: Record<string, string> }
  | { kind: 'forbidden' | 'error' | 'rotate_error' | 'download_error' | 'no_whatsapp_number' }

export function agentBookingOutcome(status: number, body: unknown, success: 'saved' | 'rotated'): AgentBookingOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as { agentBooking?: AgentBookingConfig; fields?: Record<string, string> }
  if (status === 200 && b.agentBooking) return { kind: success, agentBooking: b.agentBooking }
  if (status === 400 && b.fields) return { kind: 'fields', errors: b.fields }
  if (status === 403) return { kind: 'forbidden' }
  return { kind: success === 'saved' ? 'error' : 'rotate_error' }
}

async function sendAgentRequest(path: string, init: RequestInit, success: 'saved' | 'rotated'): Promise<AgentBookingOutcome> {
  try {
    const res = await fetch(path, init)
    return agentBookingOutcome(res.status, await res.json().catch(() => null), success)
  } catch {
    return { kind: success === 'saved' ? 'error' : 'rotate_error' }
  }
}

export type PoppyDownloadResult = 'downloaded' | 'no_whatsapp_number' | 'failed'

/**
 * Saves the file through a temporary link; otherwise why the server refused it
 * (review G2: no usable WhatsApp number has its own reason).
 * Review F8: the link is in the page while clicked (Firefox ignores a detached
 * one) and the blob URL is revoked on a later tick, after the download began.
 */
export async function downloadPoppyJson(): Promise<PoppyDownloadResult> {
  try {
    const res = await fetch('/api/dashboard/settings/booking/poppy-json')
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null
      return body?.error === 'no_whatsapp_number' ? 'no_whatsapp_number' : 'failed'
    }
    const url = URL.createObjectURL(await res.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = 'poppy.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    return 'downloaded'
  } catch {
    return 'failed'
  }
}

export function useAgentBookingSettings(initial: AgentBookingConfig) {
  const [stored, setStored] = useState<AgentBookingConfig>(initial)
  const [form, setForm] = useState<AgentBookingForm>({ enabled: initial.enabled, websiteHost: initial.websiteHost ?? '' })
  const [outcome, setOutcome] = useState<AgentBookingOutcome | null>(null)
  const [busy, setBusy] = useState(false)

  function update<K extends keyof AgentBookingForm>(key: K, value: AgentBookingForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setOutcome(null)
  }

  async function run(request: () => Promise<AgentBookingOutcome>) {
    setBusy(true)
    const result = await request()
    if (result.kind === 'saved' || result.kind === 'rotated') {
      setStored(result.agentBooking)
      setForm({ enabled: result.agentBooking.enabled, websiteHost: result.agentBooking.websiteHost ?? '' })
    }
    setOutcome(result)
    setBusy(false)
  }

  const save = () =>
    run(() =>
      sendAgentRequest('/api/dashboard/settings/booking/agent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: form.enabled, websiteHost: form.websiteHost.trim() === '' ? null : form.websiteHost.trim() }),
      }, 'saved')
    )
  const rotate = () => run(() => sendAgentRequest('/api/dashboard/settings/booking/agent/rotate', { method: 'POST' }, 'rotated'))
  async function download() {
    const result = await downloadPoppyJson()
    if (result === 'no_whatsapp_number') setOutcome({ kind: 'no_whatsapp_number' })
    else if (result === 'failed') setOutcome({ kind: 'download_error' })
  }

  return { stored, form, update, save, rotate, download, busy, outcome }
}

export type AgentBookingSettingsState = ReturnType<typeof useAgentBookingSettings>
