import type {
  TemplateSubmitResult,
  TemplateSubmitErrorTitle,
} from '@/domain/value-objects/template-submit-result'

/** Test helper: an OK TemplateSubmitResult with a deterministic Meta id. */
export function okSubmit(id = 'tpl.test', status = 'PENDING'): TemplateSubmitResult {
  return { ok: true, templateId: id, status }
}

/** Test helper: a non-OK TemplateSubmitResult with a synthetic error title. */
export function failedSubmit(
  title: TemplateSubmitErrorTitle = 'template_create_error',
  details?: string
): TemplateSubmitResult {
  return {
    ok: false,
    templateId: null,
    status: null,
    error: details === undefined ? { title } : { title, details },
  }
}
