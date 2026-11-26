/**
 * BOOK-001 W3: composition root for booking template provisioning and status
 * reads. The settings route calls these; tests mock this module or pass fakes
 * to provisionBookingTemplates directly. BOOK-002 adds the message editor's
 * read (overview) and write (edit).
 */
import { randomBytes } from 'crypto'
import { createWhatsAppTemplate } from '@/application/create-whatsapp-template'
import { updateWhatsAppTemplate } from '@/application/update-whatsapp-template'
import { ensureWabaId } from '@/application/ensure-waba-id'
import { findManyByIdsForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import {
  getBookingConfig,
  saveBookingTemplateEdit,
  saveProvisionedBookingTemplates,
} from '@/infrastructure/supabase/repositories/booking-config-repository'
import { provisionBookingTemplates } from './provision-booking-templates'
import { bookingTemplateOverview, bookingTemplateStatuses, type BookingTemplateOverview } from './booking-template-statuses'
import { editBookingTemplate, type EditBookingTemplateInput, type EditBookingTemplateResult } from './edit-booking-template'
import type { BookingTemplateStatuses } from '@/domain/services/booking-templates'
import type { BookingConfig } from '@/domain/value-objects/booking-config'

/** 6 hex chars: a fresh, valid template-name suffix per attempt. */
const suffix = () => randomBytes(3).toString('hex')

export function provisionBookingTemplatesFor(restaurantId: string): Promise<BookingTemplateStatuses> {
  return provisionBookingTemplates(restaurantId, {
    getConfig: getBookingConfig,
    findTemplates: findManyByIdsForRestaurant,
    createTemplate: createWhatsAppTemplate,
    resubmitTemplate: (id, restaurantId, components) => updateWhatsAppTemplate(id, restaurantId, { components }),
    saveProvisioned: saveProvisionedBookingTemplates,
    ensureWabaId,
    suffix,
  })
}

export function bookingTemplateStatusesFor(restaurantId: string): Promise<BookingTemplateStatuses> {
  return bookingTemplateStatuses(restaurantId, { getConfig: getBookingConfig, findTemplates: findManyByIdsForRestaurant })
}

/** `config` = the booking config the caller already read (one read per request). */
export function bookingTemplateOverviewFor(restaurantId: string, config?: BookingConfig): Promise<BookingTemplateOverview> {
  return bookingTemplateOverview(restaurantId, { getConfig: getBookingConfig, findTemplates: findManyByIdsForRestaurant }, config)
}

export function editBookingTemplateFor(input: EditBookingTemplateInput): Promise<EditBookingTemplateResult> {
  return editBookingTemplate(input, {
    getConfig: getBookingConfig,
    findTemplates: findManyByIdsForRestaurant,
    createTemplate: createWhatsAppTemplate,
    saveTemplateEdit: saveBookingTemplateEdit,
    suffix,
  })
}
