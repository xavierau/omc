import { isDeepStrictEqual } from 'node:util'
import { validateTemplateName } from '@/domain/entities/whatsapp-template'
import type {
  WhatsAppTemplate,
  TemplateCategory,
  TemplateComponent,
} from '@/domain/entities/whatsapp-template'
import {
  findTemplateByIdForRestaurant,
  updateTemplate,
} from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import {
  getMetaBusinessAccountId,
  getRestaurantPhoneNumberId,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import {
  createMetaTemplate,
  editMetaTemplate,
} from '@/infrastructure/whatsapp/templates'
import {
  normalizeTemplateComponents,
  prepareTemplateComponents,
} from '@/domain/services/prepare-template-components'
import { validateTemplateComponents } from '@/domain/services/validate-template-components'
import { resolveHeaderMedia, mapMediaHandleError } from '@/application/resolve-header-media'
import type { TemplateSubmitResult } from '@/domain/value-objects/template-submit-result'

interface UpdateTemplateInput {
  name?: string
  language?: string
  category?: TemplateCategory
  components?: TemplateComponent[]
}

interface UpdateTemplateResult {
  template: WhatsAppTemplate
  error?: string
  errorCode?: 'meta_rejected' | 'provider_not_configured' | 'provider_error' | 'meta_edited_not_saved'
}

// Distinguishes "no such template for this tenant" from a validation failure so the
// route can answer 404 instead of 400. The route layer must map it to 404.
export class TemplateNotFoundError extends Error {
  constructor() {
    super('Template not found')
    this.name = 'TemplateNotFoundError'
  }
}

// An edit Meta cannot apply in place to a live template (TPL-012). Thrown before
// any Meta call; the route answers 400 with the message, as for an invalid name.
// The only alternative would be delete + re-create, which locks the template's
// name+language on Meta for ~4 weeks and takes it offline (prod, 2026-11-24).
export class TemplateEditRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TemplateEditRefusedError'
  }
}

// restaurantId scopes the lookup rather than being compared afterwards: a template
// belonging to another tenant is simply not found, so its live Meta template can
// never be edited with this caller's payload.
export async function updateWhatsAppTemplate(
  templateId: string,
  restaurantId: string,
  input: UpdateTemplateInput
): Promise<UpdateTemplateResult> {
  const existing = await findTemplateByIdForRestaurant(templateId, restaurantId)
  if (!existing) throw new TemplateNotFoundError()

  if (input.name !== undefined && !validateTemplateName(input.name)) {
    throw new Error('Invalid template name: must be lowercase alphanumeric and underscores only')
  }
  if (existing.metaTemplateId) assertEditableInPlace(existing, input)

  const merged = { ...existing, ...input }
  const changes = normalizeChanges(input)

  // The dashboard PATCHes the full form on every save. An unchanged save of a
  // linked row must not spend Meta's once-per-24h edit or flip it to pending.
  if (existing.metaTemplateId && isNoOpEdit(existing, changes)) return { template: existing }

  const businessAccountId = await getMetaBusinessAccountId(existing.restaurantId)

  // A template that lives on Meta may only be edited when we can actually re-submit
  // it. Persisting without a re-submit would leave an approved row sendable
  // (isTemplateSendable) against a Meta definition it no longer matches.
  if (!businessAccountId) {
    if (existing.metaTemplateId) {
      return {
        template: existing,
        error: 'WhatsApp provider not configured',
        errorCode: 'provider_not_configured',
      }
    }
    return { template: await updateTemplate(templateId, changes) }
  }

  // Mint header-image handles and validate the payload BEFORE any Meta call: a
  // mint failure, or a payload Meta is certain to refuse, must change nothing.
  // Both run on a copy — the stored row keeps the image URL (changes), not the
  // ~24h handle.
  const phoneNumberId = await getRestaurantPhoneNumberId(existing.restaurantId)
  const resolved = await resolveHeaderMedia(merged.components, phoneNumberId ?? '')
  if (!resolved.ok) {
    const { message, errorCode } = mapMediaHandleError(resolved.error)
    return { template: existing, error: message, errorCode }
  }
  const validationError = validateTemplateComponents(resolved.components)
  if (validationError) {
    return { template: existing, error: validationError, errorCode: 'provider_error' }
  }

  if (existing.metaTemplateId) {
    const linked = { ...existing, metaTemplateId: existing.metaTemplateId }
    return editOnMeta(linked, changes, businessAccountId, resolved.components)
  }
  return resubmitToMeta(templateId, merged, changes, businessAccountId, resolved.components)
}

/** Refuses, before any Meta call, every edit Meta cannot make to a live template. */
function assertEditableInPlace(existing: WhatsAppTemplate, input: UpdateTemplateInput): void {
  if (input.name !== undefined && input.name !== existing.name) {
    throw new TemplateEditRefusedError(
      'A template that is on WhatsApp cannot be renamed. Create a new template with the new name instead.'
    )
  }
  if (input.language !== undefined && input.language !== existing.language) {
    throw new TemplateEditRefusedError(
      'A template that is on WhatsApp cannot change its language. Create a new template in that language instead.'
    )
  }
  if (existing.status === 'disabled') {
    throw new TemplateEditRefusedError(
      'WhatsApp has disabled this template, so it cannot be edited. Create a new template instead.'
    )
  }
  if (existing.status === 'pending') {
    throw new TemplateEditRefusedError(
      'This template is under review by WhatsApp and cannot be edited yet. Try again when the review finishes.'
    )
  }
  if (existing.status === 'approved' && categoryChanged(existing, input)) {
    throw new TemplateEditRefusedError(
      'WhatsApp does not allow changing the category of an approved template. Create a new template instead.'
    )
  }
}

/**
 * Compares the stored URL form (`changes`, not the minted-handle copy) by
 * structure: the form sends fresh objects, and jsonb does not keep key order.
 */
function isNoOpEdit(existing: WhatsAppTemplate, changes: UpdateTemplateInput): boolean {
  const components = changes.components ?? existing.components
  const category = changes.category ?? existing.category
  return category === existing.category && isDeepStrictEqual(components, existing.components)
}

function categoryChanged(existing: WhatsAppTemplate, input: UpdateTemplateInput): boolean {
  return input.category !== undefined && input.category !== existing.category
}

/**
 * Edits the live template on Meta (POST /<meta_template_id>) and never deletes
 * it. Success: Meta re-reviews it, so the row goes pending and keeps its link.
 * Any failure (edit limit, rejection, outage): nothing is persisted, so the row
 * stays consistent with the template that is still live on Meta.
 */
async function editOnMeta(
  existing: WhatsAppTemplate & { metaTemplateId: string },
  changes: UpdateTemplateInput,
  businessAccountId: string,
  submitComponents: TemplateComponent[]
): Promise<UpdateTemplateResult> {
  const { metaTemplateId } = existing
  const result = await editMetaTemplate(businessAccountId, metaTemplateId, {
    components: prepareTemplateComponents(submitComponents),
    ...(categoryChanged(existing, changes) ? { category: changes.category } : {}),
  })
  if (!result.ok) return { template: existing, ...describeEditFailure(result.error) }

  try {
    const updated = await updateTemplate(existing.id, {
      ...changes,
      status: 'pending',
      metaTemplateId,
      rejectionReason: null,
    })
    return { template: updated }
  } catch (err) {
    return reportEditedNotSaved(existing, err)
  }
}

/**
 * Meta already accepted the edit, so "nothing was changed" would be false. No
 * retry and no compensating Meta call (the next edit is a day away); log enough
 * to reconcile the row by hand and say plainly what happened.
 */
function reportEditedNotSaved(
  existing: WhatsAppTemplate & { metaTemplateId: string },
  err: unknown
): UpdateTemplateResult {
  console.error('[TPL-012] Meta edit applied but the row was not saved; reconcile by hand', {
    restaurantId: existing.restaurantId,
    templateId: existing.id,
    metaTemplateId: existing.metaTemplateId,
    error: err instanceof Error ? err.message : String(err),
  })
  return {
    template: existing,
    error:
      'WhatsApp already has the new content under review, but the app did not save it, so this page still shows the old version. Do not edit this template again; contact support to bring it back in sync.',
    errorCode: 'meta_edited_not_saved',
  }
}

function describeEditFailure(
  error: TemplateSubmitResult['error']
): Pick<UpdateTemplateResult, 'error' | 'errorCode'> {
  if (error?.title === 'kapso_no_api_key') {
    return { error: 'WhatsApp provider not configured', errorCode: 'provider_not_configured' }
  }
  const reason = error?.details ?? 'Failed to send the edit to WhatsApp'
  const errorCode = error?.title === 'meta_rejected' ? 'meta_rejected' : 'provider_error'
  return {
    error: `WhatsApp did not accept the edit, so nothing was changed and the live template is unchanged: ${reason}`,
    errorCode,
  }
}

function normalizeChanges(input: UpdateTemplateInput): UpdateTemplateInput {
  if (input.components === undefined) return input
  return { ...input, components: normalizeTemplateComponents(input.components) }
}

async function resubmitToMeta(
  templateId: string,
  merged: WhatsAppTemplate,
  changes: UpdateTemplateInput,
  businessAccountId: string,
  submitComponents: TemplateComponent[]
): Promise<UpdateTemplateResult> {
  const metaResult = await createMetaTemplate(businessAccountId, {
    name: merged.name,
    language: merged.language,
    category: merged.category,
    components: prepareTemplateComponents(submitComponents),
    parameterFormat: 'NAMED',
  })

  if (metaResult.ok) {
    const updated = await updateTemplate(templateId, {
      ...changes,
      status: 'pending',
      metaTemplateId: metaResult.templateId,
      rejectionReason: null,
    })
    return { template: updated }
  }

  // Meta judged the new template and refused it. Record that.
  if (metaResult.error?.title === 'meta_rejected') {
    const details = metaResult.error.details ?? 'Meta rejected the template'
    const updated = await updateTemplate(templateId, {
      ...changes,
      status: 'rejected',
      metaTemplateId: null,
      rejectionReason: details,
    })
    return { template: updated, error: details, errorCode: 'meta_rejected' }
  }

  // No client, so nothing was submitted. Guarded on the link: only an unlinked
  // row has no live counterpart its local edit could diverge from.
  if (metaResult.error?.title === 'kapso_no_api_key' && !merged.metaTemplateId) {
    const updated = await updateTemplate(templateId, changes)
    return {
      template: updated,
      error: 'WhatsApp provider not configured',
      errorCode: 'provider_not_configured',
    }
  }

  // The submit failed before Meta could judge it: not a content rejection.
  const details = metaResult.error?.details ?? 'Failed to submit template to Meta'
  const updated = await updateTemplate(templateId, {
    ...changes,
    status: 'draft',
    metaTemplateId: null,
    rejectionReason: details,
  })

  return { template: updated, error: details, errorCode: 'provider_error' }
}
