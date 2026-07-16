import { validateTemplateName } from '@/domain/entities/whatsapp-template'
import type {
  WhatsAppTemplate,
  TemplateCategory,
  TemplateComponent,
} from '@/domain/entities/whatsapp-template'
import {
  findTemplateById,
  updateTemplate,
} from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { getMetaBusinessAccountId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import {
  createMetaTemplate,
  deleteMetaTemplate,
} from '@/infrastructure/whatsapp/templates'
import {
  normalizeTemplateComponents,
  prepareTemplateComponents,
} from '@/domain/services/prepare-template-components'
import { validateTemplateComponents } from '@/domain/services/validate-template-components'
import { resolveHeaderMedia } from '@/application/resolve-header-media'
import type { MediaHandleErrorTitle } from '@/domain/value-objects/media-handle-result'

interface UpdateTemplateInput {
  name?: string
  language?: string
  category?: TemplateCategory
  components?: TemplateComponent[]
}

interface UpdateTemplateResult {
  template: WhatsAppTemplate
  error?: string
  errorCode?: 'meta_rejected' | 'provider_not_configured' | 'provider_error'
}

export async function updateWhatsAppTemplate(
  templateId: string,
  input: UpdateTemplateInput
): Promise<UpdateTemplateResult> {
  const existing = await findTemplateById(templateId)
  if (!existing) throw new Error('Template not found')

  if (input.name !== undefined && !validateTemplateName(input.name)) {
    throw new Error('Invalid template name: must be lowercase alphanumeric and underscores only')
  }

  const merged = { ...existing, ...input }
  const changes = normalizeChanges(input)

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

  // Mint header-image handles and validate the payload BEFORE the destructive
  // delete: a mint failure, or a payload Meta is certain to refuse, must never
  // cost the caller their live template. Both run on a copy — the stored row
  // keeps the image URL (changes), not the ~24h handle.
  const resolved = await resolveHeaderMedia(merged.components)
  if (!resolved.ok) {
    return mediaUploadError(existing, resolved.error.title, resolved.error.details)
  }
  const validationError = validateTemplateComponents(resolved.components)
  if (validationError) {
    return { template: existing, error: validationError, errorCode: 'provider_error' }
  }

  if (existing.metaTemplateId) {
    // Meta requires delete before re-create for templates with the same name.
    // If it fails the create would fail on uniqueness anyway, and clearing the link
    // afterwards would orphan a template that is still live and still sendable.
    const deleted = await deleteMetaTemplate(businessAccountId, existing.name)
    if (!deleted) {
      return {
        template: existing,
        error: 'The existing template could not be removed from Meta, so no changes were saved',
        errorCode: 'provider_error',
      }
    }
  }

  return resubmitToMeta(templateId, merged, changes, businessAccountId, resolved.components)
}

/**
 * A header image that could not be turned into a Meta handle, reported BEFORE the
 * delete so the live template is untouched. `meta_not_configured` is a skip (no
 * credentials) → provider_not_configured; a real fetch/upload error →
 * provider_error. Either way the existing row is returned unchanged.
 */
function mediaUploadError(
  existing: WhatsAppTemplate,
  title: MediaHandleErrorTitle,
  details?: string
): UpdateTemplateResult {
  if (title === 'meta_not_configured') {
    return {
      template: existing,
      error: 'Image upload is not configured',
      errorCode: 'provider_not_configured',
    }
  }
  return {
    template: existing,
    error: details ?? 'Could not upload the header image to Meta',
    errorCode: 'provider_error',
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

  // Meta refused the content: the old template is gone and the new one was judged
  // and failed. Record both facts.
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

  // No client, so nothing was submitted and nothing was deleted. Guarded on the
  // link rather than trusting that a linked template already aborted at the delete:
  // an unlinked row has no live counterpart its local edit could diverge from.
  if (metaResult.error?.title === 'kapso_no_api_key' && !merged.metaTemplateId) {
    const updated = await updateTemplate(templateId, changes)
    return {
      template: updated,
      error: 'WhatsApp provider not configured',
      errorCode: 'provider_not_configured',
    }
  }

  // The submit failed before Meta could judge it. Any old template is already gone,
  // so unlink honestly — but this is not a content rejection.
  const details = metaResult.error?.details ?? 'Failed to submit template to Meta'
  const updated = await updateTemplate(templateId, {
    ...changes,
    status: 'draft',
    metaTemplateId: null,
    rejectionReason: details,
  })

  return { template: updated, error: details, errorCode: 'provider_error' }
}
