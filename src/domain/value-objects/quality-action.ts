// WAQ-009: pure decision function mapping a quality transition to a side
// effect for the auto-pause / auto-throttle dispatcher.
//
// Policy (per WAQ-009 spec, Q1 resolution 2026-05-04):
//   - next=RED         => pause (idempotent across prev states)
//   - next=YELLOW & prev was not YELLOW => throttle factor 0.5
//   - GREEN with degraded prev (YELLOW/RED) => manual_recovery_required
//     (do NOT auto-clear; alerts ops via WAQ-013 follow-up)
//   - everything else  => no_op
//
// RED -> YELLOW deserves a special note: the tenant is recovering but is
// still degraded. The previous RED already triggered a pause, and YELLOW
// alone would normally throttle — but we must NOT replace pause with the
// looser throttle. We re-issue pause (idempotent) so the auto-pause flag
// stays set; the lower-severity transition does not "win".

import type { QualityRating } from './quality-rating'

export type QualityAction =
  | { kind: 'no_op' }
  | { kind: 'throttle'; factor: 0.5; reason: 'quality_yellow_throttle' }
  | { kind: 'pause'; reason: 'quality_red_auto' }
  | { kind: 'manual_recovery_required' }

export interface DecideQualityActionInput {
  prevRating: QualityRating | null
  nextRating: QualityRating
}

export function decideQualityAction(
  input: DecideQualityActionInput
): QualityAction {
  const { prevRating, nextRating } = input
  if (nextRating === 'UNKNOWN') return { kind: 'no_op' }
  if (nextRating === 'RED') return pauseAction()
  if (nextRating === 'YELLOW') return decideOnYellow(prevRating)
  return decideOnGreen(prevRating)
}

function decideOnYellow(prev: QualityRating | null): QualityAction {
  if (prev === 'YELLOW') return { kind: 'no_op' }
  // RED -> YELLOW: still degraded; keep the pause active rather than
  // softening to throttle. The pause is idempotent on the repo side.
  if (prev === 'RED') return pauseAction()
  return throttleAction()
}

function decideOnGreen(prev: QualityRating | null): QualityAction {
  if (prev === 'YELLOW' || prev === 'RED') {
    return { kind: 'manual_recovery_required' }
  }
  return { kind: 'no_op' }
}

function throttleAction(): QualityAction {
  return { kind: 'throttle', factor: 0.5, reason: 'quality_yellow_throttle' }
}

function pauseAction(): QualityAction {
  return { kind: 'pause', reason: 'quality_red_auto' }
}
