import type { Restaurant } from '@/domain/entities/restaurant'

export function isTrialExpired(restaurant: Restaurant): boolean {
  if (restaurant.status !== 'trial') return false
  if (!restaurant.trialExpiresAt) return true
  return new Date(restaurant.trialExpiresAt) < new Date()
}

export function isTenantAccessible(restaurant: Restaurant): boolean {
  if (restaurant.status === 'active') return true
  if (restaurant.status === 'trial') return !isTrialExpired(restaurant)
  return false
}
