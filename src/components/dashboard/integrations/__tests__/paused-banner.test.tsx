import { describe, it, expect, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `t:${key}:${JSON.stringify(vars)}` : `t:${key}`,
}))

import { PausedBannerView, shouldShowPausedBanner, type PausedBannerViewProps } from '@/components/dashboard/integrations/paused-banner'
import { renderTree, byTestId, textOf } from './render-tree-test-utils'

// -- pure functions ------------------------------------------------------

// plan Tests(first): "banner appears on paused_auto, clears on resume"
describe('shouldShowPausedBanner', () => {
  it('is true only for paused_auto', () => {
    expect(shouldShowPausedBanner('paused_auto')).toBe(true)
    expect(shouldShowPausedBanner('active')).toBe(false)
    expect(shouldShowPausedBanner('paused_manual')).toBe(false)
  })
})

// -- pure view ------------------------------------------------------------

function baseProps(overrides: Partial<PausedBannerViewProps> = {}): PausedBannerViewProps {
  return {
    failureStreak: 10,
    resumeState: 'idle',
    requeuedCount: null,
    errorCode: null,
    onResume: vi.fn(),
    ...overrides,
  }
}

describe('PausedBannerView — appears with the failure streak', () => {
  it('shows the banner and the streak count while idle', () => {
    const tree = renderTree(<PausedBannerView {...baseProps({ failureStreak: 10 })} />)
    expect(byTestId(tree, 'paused-banner')).toBeDefined()
    expect(textOf(byTestId(tree, 'paused-banner-streak'))).toContain('"count":10')
  })

  it('shows the Resume button and fires onResume when clicked', () => {
    const onResume = vi.fn()
    const tree = renderTree(<PausedBannerView {...baseProps({ onResume })} />)
    const button = byTestId(tree, 'paused-banner-resume')
    expect(button).toBeDefined()
    ;(button!.props as { onClick: () => void }).onClick()
    expect(onResume).toHaveBeenCalledTimes(1)
  })

  it('disables Resume while resuming', () => {
    const tree = renderTree(<PausedBannerView {...baseProps({ resumeState: 'resuming' })} />)
    const button = byTestId(tree, 'paused-banner-resume')
    expect((button!.props as { disabled: boolean }).disabled).toBe(true)
  })
})

describe('PausedBannerView — resume rejected: "Cannot resume: URL invalid"', () => {
  it('shows the mapped error message and keeps the streak/Resume UI visible', () => {
    const tree = renderTree(<PausedBannerView {...baseProps({ resumeState: 'error', errorCode: 'url_invalid' })} />)
    expect(byTestId(tree, 'paused-banner')).toBeDefined()
    expect(textOf(byTestId(tree, 'paused-banner-error'))).toBe('t:errorResumeUrlInvalid')
  })
})

describe('PausedBannerView — clears on resume (spec §8.2: "Banner clears")', () => {
  it('replaces the streak/Resume banner with a success confirmation once resumed', () => {
    const tree = renderTree(<PausedBannerView {...baseProps({ resumeState: 'resumed', requeuedCount: 37 })} />)
    expect(byTestId(tree, 'paused-banner')).toBeUndefined()
    expect(byTestId(tree, 'paused-banner-resume')).toBeUndefined()
    expect(textOf(byTestId(tree, 'paused-banner-resumed'))).toContain('"count":37')
  })
})
