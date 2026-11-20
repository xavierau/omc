export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed'

const ORDER: Record<Exclude<MessageStatus, 'failed'>, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
}

/**
 * Returns true iff `to` is a strictly forward transition from `from`.
 *
 * Lattice: queued < sent < delivered < read.
 * `failed` is reachable from any non-`read` state and is terminal.
 * `read` is terminal-success (cannot regress to `failed`).
 */
export function isProgression(from: MessageStatus, to: MessageStatus): boolean {
  if (from === 'failed') return false
  if (to === 'failed') return from !== 'read'
  if (from === to) return false
  return ORDER[to as Exclude<MessageStatus, 'failed'>] > ORDER[from as Exclude<MessageStatus, 'failed'>]
}
