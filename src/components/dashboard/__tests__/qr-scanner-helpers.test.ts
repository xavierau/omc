import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  computeQrbox,
  watchViewportChange,
  QR_CONFIG,
} from '../qr-scanner-helpers'

describe('computeQrbox', () => {
  it('returns a square sized to 80% of the smaller viewfinder dimension (portrait phone)', () => {
    // 390px phone minus page padding → ~342px-wide viewfinder
    expect(computeQrbox(342, 342)).toEqual({ width: 273, height: 273 })
  })

  it('uses the smaller dimension on a landscape viewfinder', () => {
    expect(computeQrbox(640, 480)).toEqual({ width: 384, height: 384 })
  })

  it('uses the smaller dimension on a portrait viewfinder', () => {
    expect(computeQrbox(360, 640)).toEqual({ width: 288, height: 288 })
  })

  it('stays within the viewfinder when the smaller dimension is at least 63px (50 / 0.8)', () => {
    for (const dim of [63, 100, 250, 342, 1080]) {
      const { width, height } = computeQrbox(dim, 900)
      expect(width).toBeLessThanOrEqual(dim)
      expect(height).toBeLessThanOrEqual(dim)
      expect(width).toBe(height)
    }
  })

  it('floors fractional results to whole pixels', () => {
    // 333 * 0.8 = 266.4 → 266
    expect(computeQrbox(333, 333)).toEqual({ width: 266, height: 266 })
  })

  it('clamps degenerate viewfinders to the library minimum qrbox (50px)', () => {
    // html5-qrcode requires qrbox >= 50px; clamp so degenerate viewfinders can't violate that
    expect(computeQrbox(40, 40)).toEqual({ width: 50, height: 50 })
    expect(computeQrbox(0, 0)).toEqual({ width: 50, height: 50 })
  })
})

describe('QR_CONFIG', () => {
  it('passes computeQrbox itself so the box tracks the live viewfinder', () => {
    // A regression like `qrbox: computeQrbox(250, 250)` (pre-computed fixed size)
    // would compile and silently restore the too-small scanner.
    expect(QR_CONFIG.qrbox).toBe(computeQrbox)
  })
})

describe('watchViewportChange', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces rapid resize events into a single callback', () => {
    vi.useFakeTimers()
    const target = new EventTarget()
    const onChange = vi.fn()
    watchViewportChange(target, onChange)

    target.dispatchEvent(new Event('resize'))
    target.dispatchEvent(new Event('resize'))
    target.dispatchEvent(new Event('resize'))
    expect(onChange).not.toHaveBeenCalled()

    vi.runAllTimers()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('fires on orientationchange', () => {
    vi.useFakeTimers()
    const target = new EventTarget()
    const onChange = vi.fn()
    watchViewportChange(target, onChange)

    target.dispatchEvent(new Event('orientationchange'))
    vi.runAllTimers()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('stops listening and cancels pending callbacks after cleanup', () => {
    vi.useFakeTimers()
    const target = new EventTarget()
    const onChange = vi.fn()
    const cleanup = watchViewportChange(target, onChange)

    target.dispatchEvent(new Event('resize'))
    cleanup()
    vi.runAllTimers()
    target.dispatchEvent(new Event('resize'))
    vi.runAllTimers()

    expect(onChange).not.toHaveBeenCalled()
  })
})
