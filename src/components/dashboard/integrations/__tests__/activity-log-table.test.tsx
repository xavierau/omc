import { describe, it, expect, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `t:${key}:${JSON.stringify(vars)}` : `t:${key}`,
}))

import {
  ActivityLogView,
  welcomeOutcomeLabelKey,
  assertedLevelLabelKey,
  formatConsentActions,
  type ActivityLogViewProps,
} from '@/components/dashboard/integrations/activity-log-table'
import { renderTree, byTestId, textOf } from './render-tree-test-utils'
import type { IntegrationActivityItem } from '@/hooks/integrations-client'

// -- pure functions ------------------------------------------------------

// decide-welcome.ts / process-welcome-send-job.ts's full outcome
// vocabulary (WI-3/WI-4) — every value that can land in `welcomeOutcome`.
describe('welcomeOutcomeLabelKey', () => {
  it.each([
    ['queued', 'welcomeStatusQueued'],
    ['sent', 'welcomeStatusSent'],
    ['failed', 'welcomeStatusFailed'],
    ['skipped_existing', 'welcomeStatusSkippedExisting'],
    ['skipped_by_request', 'welcomeStatusSkippedByRequest'],
    ['skipped_off', 'welcomeStatusSkippedOff'],
    ['skipped_opted_out', 'welcomeStatusSkippedOptedOut'],
    ['skipped_no_template', 'welcomeStatusSkippedNoTemplate'],
    ['skipped_consent_level', 'welcomeStatusSkippedConsentLevel'],
    ['skipped_quality_paused', 'welcomeStatusSkippedQualityPaused'],
    ['skipped_rate_capped', 'welcomeStatusSkippedRateCapped'],
    ['skipped_member_missing', 'welcomeStatusSkippedMemberMissing'],
  ])('maps %s -> %s', (outcome, key) => {
    expect(welcomeOutcomeLabelKey(outcome)).toBe(key)
  })

  it('maps null to welcomeStatusNone', () => {
    expect(welcomeOutcomeLabelKey(null)).toBe('welcomeStatusNone')
  })

  it('falls back to welcomeStatusUnknown for an unrecognized outcome', () => {
    expect(welcomeOutcomeLabelKey('some_future_outcome')).toBe('welcomeStatusUnknown')
  })
})

describe('assertedLevelLabelKey', () => {
  it.each([
    ['none', 'assertedLevelNone'],
    ['utility', 'assertedLevelUtility'],
    ['all', 'assertedLevelAll'],
  ] as const)('maps %s -> %s', (level, key) => {
    expect(assertedLevelLabelKey(level)).toBe(key)
  })
})

describe('formatConsentActions', () => {
  it('formats every category/action pair', () => {
    expect(formatConsentActions({ utility: 'opted_in', marketing: 'no_change' })).toEqual([
      { category: 'utility', action: 'opted_in' },
      { category: 'marketing', action: 'no_change' },
    ])
  })

  it('returns [] for null', () => {
    expect(formatConsentActions(null)).toEqual([])
  })

  it('returns [] for an empty object', () => {
    expect(formatConsentActions({})).toEqual([])
  })
})

// -- pure view ------------------------------------------------------------

function activityRow(overrides: Partial<IntegrationActivityItem> = {}): IntegrationActivityItem {
  return {
    jobId: 'job-1',
    status: 'succeeded',
    outcome: 'created',
    assertedLevel: 'all',
    consentActions: { utility: 'opted_in', marketing: 'opted_in' },
    welcomeOutcome: 'sent',
    welcomeDetail: { whatsapp_message_id: 'wamid.1' },
    phoneLast4: '1234',
    submittedAt: '2026-09-10T00:00:00Z',
    ...overrides,
  }
}

function baseProps(overrides: Partial<ActivityLogViewProps> = {}): ActivityLogViewProps {
  return {
    rows: [],
    isLoading: false,
    loadError: null,
    hasMore: false,
    loadingMore: false,
    onLoadMore: vi.fn(),
    ...overrides,
  }
}

describe('ActivityLogView — loading/empty/error states', () => {
  it('shows a loading indicator while loading', () => {
    const tree = renderTree(<ActivityLogView {...baseProps({ isLoading: true })} />)
    expect(byTestId(tree, 'activity-log-loading')).toBeDefined()
  })

  it('shows the empty state when there are no rows', () => {
    const tree = renderTree(<ActivityLogView {...baseProps({ rows: [] })} />)
    expect(byTestId(tree, 'activity-log-empty')).toBeDefined()
  })

  it('shows the load-failed message on a load error', () => {
    const tree = renderTree(<ActivityLogView {...baseProps({ loadError: 'Forbidden' })} />)
    expect(textOf(byTestId(tree, 'activity-log-error'))).toBe('t:activityLoadFailed')
  })
})

describe('ActivityLogView — rows', () => {
  it('renders one row per member job', () => {
    const tree = renderTree(<ActivityLogView {...baseProps({ rows: [activityRow()] })} />)
    expect(byTestId(tree, 'activity-row-job-1')).toBeDefined()
  })

  it('shows the create outcome for a created job', () => {
    const tree = renderTree(<ActivityLogView {...baseProps({ rows: [activityRow({ outcome: 'created' })] })} />)
    expect(textOf(byTestId(tree, 'activity-outcome-job-1'))).toBe('t:activityOutcomeCreated')
  })

  it('shows the existing outcome for an idempotent-hit job', () => {
    const tree = renderTree(<ActivityLogView {...baseProps({ rows: [activityRow({ outcome: 'existing' })] })} />)
    expect(textOf(byTestId(tree, 'activity-outcome-job-1'))).toBe('t:activityOutcomeExisting')
  })

  it('shows the job status when outcome is not yet set (still processing)', () => {
    const tree = renderTree(
      <ActivityLogView {...baseProps({ rows: [activityRow({ outcome: null, status: 'processing' })] })} />
    )
    expect(textOf(byTestId(tree, 'activity-outcome-job-1'))).toBe('t:activityJobStatusProcessing')
  })

  it('renders phone as last4 only, never the full phone', () => {
    const tree = renderTree(<ActivityLogView {...baseProps({ rows: [activityRow({ phoneLast4: '9876' })] })} />)
    const text = textOf(byTestId(tree, 'activity-phone-job-1'))
    expect(text).toContain('9876')
    expect(text.replace(/\D/g, '').length).toBe(4)
  })

  it('renders the skipped_consent_level sentence with the required/effective levels interpolated', () => {
    const tree = renderTree(
      <ActivityLogView
        {...baseProps({
          rows: [
            activityRow({
              welcomeOutcome: 'skipped_consent_level',
              welcomeDetail: { required_level: 'all', effective_level: 'utility' },
            }),
          ],
        })}
      />
    )
    const text = textOf(byTestId(tree, 'activity-welcome-job-1'))
    expect(text).toContain('welcomeStatusSkippedConsentLevel')
    expect(text).toContain('"level":"utility"')
    expect(text).toContain('"required":"all"')
  })

  it('renders consent actions as category:action pairs', () => {
    const tree = renderTree(
      <ActivityLogView {...baseProps({ rows: [activityRow({ consentActions: { utility: 'opted_in' } })] })} />
    )
    expect(textOf(byTestId(tree, 'activity-consent-actions-job-1'))).toContain('utility: opted_in')
  })

  it('shows — when there are no consent actions', () => {
    const tree = renderTree(<ActivityLogView {...baseProps({ rows: [activityRow({ consentActions: null })] })} />)
    expect(textOf(byTestId(tree, 'activity-consent-actions-job-1'))).toBe('—')
  })
})

describe('ActivityLogView — pagination', () => {
  it('shows Load more when hasMore is true', () => {
    const tree = renderTree(<ActivityLogView {...baseProps({ rows: [activityRow()], hasMore: true })} />)
    expect(byTestId(tree, 'activity-load-more')).toBeDefined()
  })

  it('hides Load more when hasMore is false', () => {
    const tree = renderTree(<ActivityLogView {...baseProps({ rows: [activityRow()], hasMore: false })} />)
    expect(byTestId(tree, 'activity-load-more')).toBeUndefined()
  })
})

// Deviation from the plan's literal "escaped metadata/external_ref
// rendering" test case, disclosed in this file's header comment and the
// WI-10 handoff artifact: WI-8's IntegrationActivityItem carries neither
// field. Adapted to prove the same structural guarantee against a field
// this route actually returns.
describe('ActivityLogView — escaped rendering (structural, adapted from the plan, see file header)', () => {
  it('renders an unrecognized welcomeOutcome value through the safe key map, never the raw string', () => {
    const payload = '<img src=x onerror=alert(1)>'
    const tree = renderTree(<ActivityLogView {...baseProps({ rows: [activityRow({ welcomeOutcome: payload })] })} />)
    const text = textOf(byTestId(tree, 'activity-welcome-job-1'))
    expect(text).toBe('t:welcomeStatusUnknown')
    expect(text).not.toContain(payload)
  })

  it('renders a consentActions value as literal JSX text, never as markup', () => {
    const payload = '<script>alert(1)</script>'
    const tree = renderTree(
      <ActivityLogView {...baseProps({ rows: [activityRow({ consentActions: { utility: payload } })] })} />
    )
    expect(textOf(byTestId(tree, 'activity-consent-actions-job-1'))).toContain(payload)
  })
})
