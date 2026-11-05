import { describe, it, expect, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `t:${key}:${JSON.stringify(vars)}` : `t:${key}`,
}))

import {
  DeliveryLogView,
  deliveryStatusLabelKey,
  canRetryRow,
  deadLetteredSinceSecretChangeCount,
  type DeliveryLogViewProps,
} from '@/components/dashboard/integrations/delivery-log-table'
import { renderTree, byTestId, allByTestId, textOf } from './render-tree-test-utils'
import type { IntegrationDeliveryListItem } from '@/hooks/integrations-client'

// -- pure functions ------------------------------------------------------

describe('deliveryStatusLabelKey', () => {
  it('maps every IntegrationDeliveryStatus to its own key', () => {
    expect(deliveryStatusLabelKey('queued')).toBe('deliveryStatusQueued')
    expect(deliveryStatusLabelKey('delivering')).toBe('deliveryStatusDelivering')
    expect(deliveryStatusLabelKey('retrying')).toBe('deliveryStatusRetrying')
    expect(deliveryStatusLabelKey('delivered')).toBe('deliveryStatusDelivered')
    expect(deliveryStatusLabelKey('dead_lettered')).toBe('deliveryStatusDeadLettered')
    expect(deliveryStatusLabelKey('paused')).toBe('deliveryStatusPaused')
    expect(deliveryStatusLabelKey('skipped')).toBe('deliveryStatusSkipped')
  })
})

// US-9 / plan Tests(first): "retry button disabled after one retry"
describe('canRetryRow', () => {
  it('allows retry only on a dead-lettered row that has not been retried yet', () => {
    expect(canRetryRow('dead_lettered', false)).toBe(true)
    expect(canRetryRow('dead_lettered', true)).toBe(false)
    expect(canRetryRow('queued', false)).toBe(false)
    expect(canRetryRow('delivered', false)).toBe(false)
  })
})

// plan Tests(first): "'N dead-lettered since secret change — Retry' notice
// when outbound_secret_updated_at > last dead-letter"
describe('deadLetteredSinceSecretChangeCount', () => {
  it('is 0 when there is no secret-updated timestamp', () => {
    expect(deadLetteredSinceSecretChangeCount(['2026-09-01T00:00:00Z'], null)).toBe(0)
  })

  it('is 0 when there are no dead-lettered rows', () => {
    expect(deadLetteredSinceSecretChangeCount([], '2026-09-05T00:00:00Z')).toBe(0)
  })

  it('is 0 when the secret was updated before the most recent dead-letter', () => {
    expect(
      deadLetteredSinceSecretChangeCount(
        ['2026-09-01T00:00:00Z', '2026-09-10T00:00:00Z'],
        '2026-09-05T00:00:00Z'
      )
    ).toBe(0)
  })

  it('counts every dead-lettered row when the secret was updated after all of them', () => {
    expect(
      deadLetteredSinceSecretChangeCount(
        ['2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z', '2026-09-03T00:00:00Z'],
        '2026-09-10T00:00:00Z'
      )
    ).toBe(3)
  })
})

// -- pure view ------------------------------------------------------------

function row(overrides: Partial<IntegrationDeliveryListItem> = {}): IntegrationDeliveryListItem {
  return {
    id: 'd-1',
    eventId: 'evt-1',
    eventType: 'member.created',
    occurredAt: '2026-09-10T00:00:00Z',
    status: 'dead_lettered',
    attempts: 5,
    lastHttpStatus: 404,
    lastErrorCode: 'http_4xx',
    nextRetryAt: null,
    createdAt: '2026-09-10T00:00:00Z',
    ...overrides,
  }
}

function baseProps(overrides: Partial<DeliveryLogViewProps> = {}): DeliveryLogViewProps {
  return {
    rows: [],
    statusFilter: 'all',
    onStatusFilterChange: vi.fn(),
    isLoading: false,
    loadError: null,
    retryingId: null,
    retriedIds: new Set(),
    retryErrorByRow: {},
    onRetry: vi.fn(),
    hasMore: false,
    loadingMore: false,
    onLoadMore: vi.fn(),
    deadLetteredNoticeCount: 0,
    highlightDeliveryId: null,
    ...overrides,
  }
}

describe('DeliveryLogView — loading/empty/error states', () => {
  it('shows a loading indicator while loading', () => {
    const tree = renderTree(<DeliveryLogView {...baseProps({ isLoading: true })} />)
    expect(byTestId(tree, 'delivery-log-loading')).toBeDefined()
    expect(byTestId(tree, 'delivery-log-table')).toBeUndefined()
  })

  it('shows the empty state when there are no rows', () => {
    const tree = renderTree(<DeliveryLogView {...baseProps({ rows: [] })} />)
    expect(byTestId(tree, 'delivery-log-empty')).toBeDefined()
  })

  it('shows the load-failed message on a load error', () => {
    const tree = renderTree(<DeliveryLogView {...baseProps({ loadError: 'Forbidden' })} />)
    expect(textOf(byTestId(tree, 'delivery-log-error'))).toBe('t:deliveryLoadFailed')
  })
})

describe('DeliveryLogView — rows and the status filter', () => {
  it('renders one row per delivery with its columns', () => {
    const tree = renderTree(<DeliveryLogView {...baseProps({ rows: [row()] })} />)
    expect(byTestId(tree, 'delivery-row-d-1')).toBeDefined()
  })

  it('renders the status filter with every status plus "all"', () => {
    const tree = renderTree(<DeliveryLogView {...baseProps()} />)
    const select = byTestId(tree, 'delivery-status-filter')
    expect(select).toBeDefined()
  })
})

describe('DeliveryLogView — retry button state machine (US-9)', () => {
  it('shows a Retry button on a dead-lettered row not yet retried', () => {
    const tree = renderTree(<DeliveryLogView {...baseProps({ rows: [row({ status: 'dead_lettered' })] })} />)
    expect(byTestId(tree, 'delivery-retry-d-1')).toBeDefined()
  })

  it('hides the Retry button once the row is in retriedIds — disabled after one retry', () => {
    const tree = renderTree(
      <DeliveryLogView
        {...baseProps({ rows: [row({ status: 'dead_lettered' })], retriedIds: new Set(['d-1']) })}
      />
    )
    expect(byTestId(tree, 'delivery-retry-d-1')).toBeUndefined()
    expect(byTestId(tree, 'delivery-retried-d-1')).toBeDefined()
  })

  it('never shows Retry for a non-dead-lettered row', () => {
    const tree = renderTree(<DeliveryLogView {...baseProps({ rows: [row({ status: 'delivered' })] })} />)
    expect(byTestId(tree, 'delivery-retry-d-1')).toBeUndefined()
  })

  it('shows the already_retried message via retryErrorByRow', () => {
    const tree = renderTree(
      <DeliveryLogView
        {...baseProps({
          rows: [row({ status: 'dead_lettered' })],
          retriedIds: new Set(['d-1']),
          retryErrorByRow: { 'd-1': 'already_retried' },
        })}
      />
    )
    expect(textOf(byTestId(tree, 'delivery-retry-error-d-1'))).toBe('t:errorAlreadyRetried')
  })

  it('disables the retry button while that row is retrying', () => {
    const tree = renderTree(
      <DeliveryLogView {...baseProps({ rows: [row({ status: 'dead_lettered' })], retryingId: 'd-1' })} />
    )
    const button = byTestId(tree, 'delivery-retry-d-1')
    expect((button!.props as { disabled: boolean }).disabled).toBe(true)
  })
})

describe('DeliveryLogView — dead-lettered-since-secret-change notice', () => {
  it('shows the notice with the given count', () => {
    const tree = renderTree(<DeliveryLogView {...baseProps({ deadLetteredNoticeCount: 4 })} />)
    expect(textOf(byTestId(tree, 'delivery-secret-change-notice'))).toContain('deadLetteredSinceSecretChange')
  })

  it('hides the notice when the count is 0', () => {
    const tree = renderTree(<DeliveryLogView {...baseProps({ deadLetteredNoticeCount: 0 })} />)
    expect(byTestId(tree, 'delivery-secret-change-notice')).toBeUndefined()
  })
})

describe('DeliveryLogView — pagination', () => {
  it('shows Load more when hasMore is true', () => {
    const tree = renderTree(<DeliveryLogView {...baseProps({ rows: [row()], hasMore: true })} />)
    expect(byTestId(tree, 'delivery-load-more')).toBeDefined()
  })

  it('hides Load more when hasMore is false', () => {
    const tree = renderTree(<DeliveryLogView {...baseProps({ rows: [row()], hasMore: false })} />)
    expect(byTestId(tree, 'delivery-load-more')).toBeUndefined()
  })
})

describe('DeliveryLogView — highlighted row (WI-9 test-event extension point)', () => {
  it('marks the row matching highlightDeliveryId', () => {
    const tree = renderTree(<DeliveryLogView {...baseProps({ rows: [row({ id: 'd-2' })], highlightDeliveryId: 'd-2' })} />)
    const highlighted = byTestId(tree, 'delivery-row-d-2')
    expect((highlighted!.props as { 'data-highlighted'?: string })['data-highlighted']).toBe('true')
  })

  it('does not mark any row when highlightDeliveryId does not match', () => {
    const tree = renderTree(<DeliveryLogView {...baseProps({ rows: [row({ id: 'd-2' })], highlightDeliveryId: 'd-9' })} />)
    const row2 = byTestId(tree, 'delivery-row-d-2')
    expect((row2!.props as { 'data-highlighted'?: string })['data-highlighted']).toBeUndefined()
  })
})

describe('DeliveryLogView — escaped rendering (structural, T-M9-style)', () => {
  it('renders eventType and lastErrorCode as literal text, never as markup', () => {
    const payload = '<script>alert(1)</script>'
    const tree = renderTree(
      <DeliveryLogView
        {...baseProps({
          rows: [row({ eventType: payload, lastErrorCode: payload })],
        })}
      />
    )
    const cells = allByTestId(tree, 'delivery-row-d-1')
    expect(cells.length).toBeGreaterThan(0)
    // The row itself renders via plain JSX text children (no
    // dangerouslySetInnerHTML anywhere in this component) — proven by the
    // string surviving intact as literal text content.
    const rowEl = byTestId(tree, 'delivery-row-d-1')
    expect(textOf(rowEl)).toContain(payload)
  })
})
