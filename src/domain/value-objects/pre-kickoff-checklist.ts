// WONB-001: six-item pre-kickoff checklist (playbook §2.1). For paths
// B1/B2/B3 (coexistence variants), `hk_sim_never_used` is auto-N/A and
// counts as satisfied. Tick attempts on N/A items are no-ops by design so
// the UI can render disabled controls without throwing.

import type { OnboardingPath } from './onboarding-path'

export type ChecklistItemStatus = 'pending' | 'not_applicable'

export interface ChecklistItem {
  readonly checked: boolean
  readonly status: ChecklistItemStatus
  readonly checkedAt: string | null
  readonly checkedBy: string | null
}

export type ChecklistKey =
  | 'hk_sim_never_used'
  | 'verified_meta_business'
  | 'display_name_draft_approved'
  | 'opt_in_source_documented'
  | 'vertical_allowed'
  | 'first_three_campaigns_drafted'

export type PreKickoffChecklist = Readonly<Record<ChecklistKey, ChecklistItem>>

export const CHECKLIST_KEYS: readonly ChecklistKey[] = Object.freeze([
  'hk_sim_never_used',
  'verified_meta_business',
  'display_name_draft_approved',
  'opt_in_source_documented',
  'vertical_allowed',
  'first_three_campaigns_drafted',
])

const PATHS_WITH_NA_SIM: readonly OnboardingPath[] = ['B1', 'B2', 'B3']

export function isChecklistKey(value: unknown): value is ChecklistKey {
  return (
    typeof value === 'string' &&
    (CHECKLIST_KEYS as readonly string[]).includes(value)
  )
}

function pendingItem(): ChecklistItem {
  return Object.freeze({
    checked: false,
    status: 'pending',
    checkedAt: null,
    checkedBy: null,
  })
}

function notApplicableItem(): ChecklistItem {
  return Object.freeze({
    checked: true,
    status: 'not_applicable',
    checkedAt: null,
    checkedBy: null,
  })
}

function isSimNotApplicable(path: OnboardingPath | null): boolean {
  return path !== null && PATHS_WITH_NA_SIM.includes(path)
}

export function buildInitialChecklist(
  path: OnboardingPath | null
): PreKickoffChecklist {
  const out: Partial<Record<ChecklistKey, ChecklistItem>> = {}
  for (const key of CHECKLIST_KEYS) {
    out[key] =
      key === 'hk_sim_never_used' && isSimNotApplicable(path)
        ? notApplicableItem()
        : pendingItem()
  }
  return Object.freeze(out as Record<ChecklistKey, ChecklistItem>)
}

function assertKey(key: ChecklistKey): void {
  if (!isChecklistKey(key)) {
    throw new Error(`pre-kickoff-checklist: unknown checklist key: ${String(key)}`)
  }
}

function withItem(
  c: PreKickoffChecklist,
  key: ChecklistKey,
  next: ChecklistItem
): PreKickoffChecklist {
  return Object.freeze({ ...c, [key]: next }) as PreKickoffChecklist
}

export interface ApplyTickOptions {
  readonly actor: string
  readonly now: string
}

export function applyTick(
  c: PreKickoffChecklist,
  key: ChecklistKey,
  opts: ApplyTickOptions
): PreKickoffChecklist {
  assertKey(key)
  const item = c[key]
  if (item.status === 'not_applicable') return c
  return withItem(
    c,
    key,
    Object.freeze({
      checked: true,
      status: 'pending',
      checkedAt: opts.now,
      checkedBy: opts.actor,
    })
  )
}

export function applyUntick(
  c: PreKickoffChecklist,
  key: ChecklistKey
): PreKickoffChecklist {
  assertKey(key)
  const item = c[key]
  if (item.status === 'not_applicable') return c
  return withItem(c, key, pendingItem())
}

export function isChecklistComplete(c: PreKickoffChecklist): boolean {
  for (const key of CHECKLIST_KEYS) {
    if (!c[key].checked) return false
  }
  return true
}
