import { describe, it, expect } from 'vitest'
import { computeQrbox } from '../qr-scanner-helpers'

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

  it('never exceeds either viewfinder dimension', () => {
    const { width, height } = computeQrbox(100, 900)
    expect(width).toBeLessThanOrEqual(100)
    expect(height).toBeLessThanOrEqual(100)
    expect(width).toBe(height)
  })

  it('clamps degenerate viewfinders to the library minimum qrbox (50px)', () => {
    // html5-qrcode rejects qrbox < 50px, which would surface as "camera blocked"
    expect(computeQrbox(40, 40)).toEqual({ width: 50, height: 50 })
    expect(computeQrbox(0, 0)).toEqual({ width: 50, height: 50 })
  })

  it('floors fractional results to whole pixels', () => {
    // 333 * 0.8 = 266.4 → 266
    expect(computeQrbox(333, 333)).toEqual({ width: 266, height: 266 })
  })
})
