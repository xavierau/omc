/**
 * Render a simple {{variable}} template using the provided vars map.
 *
 * Substitution rules:
 *   - Known placeholder with a non-nullish value → stringified value.
 *   - Missing / null / undefined → empty string (NOT the literal "null").
 *   - Number values are coerced via String().
 *   - Repeated placeholders all resolve to the same value.
 *
 * The `{{placeholder}}` (double-brace) syntax matches campaign templates
 * already stored in the database — do not change without a data migration.
 */
export type TemplateVar = string | number | null | undefined
export type TemplateVars = Record<string, TemplateVar>

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(PLACEHOLDER_RE, (_, key: string) => {
    const value = vars[key]
    if (value === null || value === undefined) return ''
    return String(value)
  })
}
