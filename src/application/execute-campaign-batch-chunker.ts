// WAQ-010 Phase 1 — engagement-tier chunker.
//
// Splits a member array into sequential chunks based on per-tenant pacing
// config. The FIRST chunk uses `probeChunkSize` (the high-engagement probe
// per the WAQ-010 spec); every chunk after that uses `scaleChunkSize`.
//
// `naive` strategy preserves the legacy fixed-20 batch path for tenants who
// opted out of engagement-tier pacing.

import type { Member } from '@/domain/entities/member'
import type { PacingConfig } from '@/domain/value-objects/pacing-strategy'

const NAIVE_BATCH_SIZE = 20

export interface ChunkPlan {
  isProbe: boolean
  members: Member[]
}

export function planChunks(
  members: Member[],
  config: PacingConfig
): ChunkPlan[] {
  if (config.strategy === 'naive') {
    return planFixedChunks(members, NAIVE_BATCH_SIZE)
  }
  return planProbeThenScale(members, config)
}

function planFixedChunks(members: Member[], size: number): ChunkPlan[] {
  const out: ChunkPlan[] = []
  for (let i = 0; i < members.length; i += size) {
    // Naive runs do not have a probe — every chunk is "scale". The flag
    // stays false so callers don't emit the probe-boundary log for naive.
    out.push({ isProbe: false, members: members.slice(i, i + size) })
  }
  return out
}

function planProbeThenScale(
  members: Member[],
  config: PacingConfig
): ChunkPlan[] {
  if (members.length === 0) return []
  const probe = members.slice(0, config.probeChunkSize)
  const rest = members.slice(config.probeChunkSize)
  const out: ChunkPlan[] = [{ isProbe: true, members: probe }]
  for (let i = 0; i < rest.length; i += config.scaleChunkSize) {
    out.push({
      isProbe: false,
      members: rest.slice(i, i + config.scaleChunkSize),
    })
  }
  return out
}
