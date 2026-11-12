'use client'

/**
 * BOOK-001 W3: the booking settings summary from GET
 * /api/dashboard/settings/booking — the mode and external URL the campaign
 * form needs for its Book now toggle, and each booking template's status for
 * the settings section. Fetched once per mount; null until loaded or on error.
 */
import { useEffect, useState } from 'react'
import { BOOKING_MODES, TEMPLATE_KINDS, TEMPLATE_LANGUAGES, type BookingMode } from '@/domain/value-objects/booking-config'
import type { BookingTemplateStatus, BookingTemplateStatuses } from '@/domain/services/booking-templates'

export interface BookingAvailability {
  mode: BookingMode
  externalUrl: string | null
}

export interface BookingSettingsSummary {
  availability: BookingAvailability
  templates: BookingTemplateStatuses | null
}

const STATUSES: readonly BookingTemplateStatus[] = ['approved', 'pending', 'rejected', 'failed', 'not_submitted']

/** Validates the template statuses a response carries; anything malformed → null. */
export function parseTemplateStatuses(raw: unknown): BookingTemplateStatuses | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, Record<string, unknown> | undefined>
  for (const kind of TEMPLATE_KINDS) {
    for (const lang of TEMPLATE_LANGUAGES) {
      if (!STATUSES.includes(source[kind]?.[lang] as BookingTemplateStatus)) return null
    }
  }
  return raw as BookingTemplateStatuses
}

export function parseBookingSettingsSummary(raw: unknown): BookingSettingsSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!BOOKING_MODES.includes(r.mode as BookingMode)) return null
  const externalUrl = typeof r.externalUrl === 'string' ? r.externalUrl : null
  return { availability: { mode: r.mode as BookingMode, externalUrl }, templates: parseTemplateStatuses(r.templates) }
}

export function useBookingSettingsSummary(): BookingSettingsSummary | null {
  const [summary, setSummary] = useState<BookingSettingsSummary | null>(null)
  useEffect(() => {
    let live = true
    fetch('/api/dashboard/settings/booking')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => live && setSummary(parseBookingSettingsSummary(json)))
      .catch(() => live && setSummary(null))
    return () => {
      live = false
    }
  }, [])
  return summary
}

export function useBookingAvailability(): BookingAvailability | null {
  return useBookingSettingsSummary()?.availability ?? null
}
