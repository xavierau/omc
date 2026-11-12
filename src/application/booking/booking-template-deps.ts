/**
 * BOOK-001 W3: composition root for booking template provisioning and status
 * reads. The settings route calls these; tests mock this module or pass fakes
 * to provisionBookingTemplates directly.
 */
import { randomBytes } from 'crypto'
import { createWhatsAppTemplate } from '@/application/create-whatsapp-template'
import { findManyByIdsForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { getBookingConfig, saveBookingTemplateIds } from '@/infrastructure/supabase/repositories/booking-config-repository'
import { provisionBookingTemplates } from './provision-booking-templates'
import { bookingTemplateStatuses } from './booking-template-statuses'
import type { BookingTemplateStatuses } from '@/domain/services/booking-templates'

/** 6 hex chars: a fresh, valid template-name suffix per attempt. */
const suffix = () => randomBytes(3).toString('hex')

export function provisionBookingTemplatesFor(restaurantId: string): Promise<BookingTemplateStatuses> {
  return provisionBookingTemplates(restaurantId, {
    getConfig: getBookingConfig,
    findTemplates: findManyByIdsForRestaurant,
    createTemplate: createWhatsAppTemplate,
    saveTemplateIds: saveBookingTemplateIds,
    suffix,
  })
}

export function bookingTemplateStatusesFor(restaurantId: string): Promise<BookingTemplateStatuses> {
  return bookingTemplateStatuses(restaurantId, { getConfig: getBookingConfig, findTemplates: findManyByIdsForRestaurant })
}
