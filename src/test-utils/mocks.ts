import { vi } from 'vitest'
import { okResult } from './send-result'

export function mockCouponRepository() {
  return {
    findCouponByCode: vi.fn().mockResolvedValue(null),
    redeemCoupon: vi.fn().mockResolvedValue(undefined),
    incrementCouponUses: vi.fn().mockResolvedValue(undefined),
    decrementCouponUses: vi.fn().mockResolvedValue(undefined),
    createCoupon: vi.fn().mockResolvedValue(null),
    createWelcomeCoupon: vi.fn().mockResolvedValue(null),
  }
}

export function mockCouponRedemptionRepository() {
  return {
    createRedemption: vi.fn().mockResolvedValue(undefined),
    hasRedeemed: vi.fn().mockResolvedValue(false),
  }
}

export function mockEventRepository() {
  return {
    createEvent: vi.fn().mockResolvedValue('event-1'),
  }
}

export function mockCampaignRepository() {
  return {
    getCampaignById: vi.fn().mockResolvedValue(null),
    incrementCampaignRedeemed: vi.fn().mockResolvedValue(undefined),
    incrementCampaignSent: vi.fn().mockResolvedValue(undefined),
    transitionCampaignStatus: vi.fn().mockResolvedValue(true),
    updateCampaign: vi.fn().mockResolvedValue(undefined),
    setCampaignMembers: vi.fn().mockResolvedValue(undefined),
    getCampaignMemberIds: vi.fn().mockResolvedValue([]),
  }
}

export function mockRestaurantRepository() {
  return {
    getRestaurantPhoneNumberId: vi.fn().mockResolvedValue('phone-id'),
    getRestaurantName: vi.fn().mockResolvedValue('Test Restaurant'),
    findBySlug: vi.fn().mockResolvedValue(null),
  }
}

export function mockKapsoClient() {
  // The WhatsAppMessagingPort now requires a SendResult — returning
  // `undefined` means callers that destructure `result.kapsoMessageId`
  // silently see `undefined` and the test misses the regression.
  return {
    sendTextMessage: vi.fn().mockResolvedValue(okResult()),
    sendImageMessage: vi.fn().mockResolvedValue(okResult()),
    sendInteractiveButtons: vi.fn().mockResolvedValue(okResult()),
    sendInteractiveList: vi.fn().mockResolvedValue(okResult()),
    sendCtaUrlButton: vi.fn().mockResolvedValue(okResult()),
    sendInteractiveFlow: vi.fn().mockResolvedValue(okResult()),
  }
}

export function mockRewardRepository() {
  return {
    getRewardById: vi.fn().mockResolvedValue(null),
    listActiveRewards: vi.fn().mockResolvedValue([]),
  }
}

export function mockMemberRepository() {
  return {
    adjustMemberPoints: vi.fn().mockResolvedValue(100),
    findMemberByPhone: vi.fn().mockResolvedValue(null),
  }
}

export function mockReceiptRepository() {
  return {
    updateReceipt: vi.fn().mockResolvedValue(undefined),
    createReceipt: vi.fn().mockResolvedValue('receipt-1'),
  }
}

export function mockSupabaseStorage() {
  return {
    uploadCouponQr: vi.fn().mockResolvedValue('https://example.com/qr.png'),
  }
}

export function mockWhatsAppTemplateRepository() {
  return {
    findTemplateById: vi.fn().mockResolvedValue(null),
  }
}

export function mockPosIntegrationRepository() {
  return {
    findPosIntegrationById: vi.fn().mockResolvedValue(null),
    findPosIntegrationsByRestaurant: vi.fn().mockResolvedValue([]),
    createPosIntegration: vi.fn().mockResolvedValue('pos-integration-1'),
    updatePosIntegration: vi.fn().mockResolvedValue(undefined),
    deletePosIntegration: vi.fn().mockResolvedValue(undefined),
  }
}

export function mockPosTransactionRepository() {
  return {
    createPosTransaction: vi.fn().mockResolvedValue('pos-tx-1'),
    findPosTransactionByExternalId: vi.fn().mockResolvedValue(null),
    findPosTransactionsByRestaurant: vi.fn().mockResolvedValue([]),
    updatePosTransactionMember: vi.fn().mockResolvedValue(undefined),
    findUnlinkedTransactionsByPhone: vi.fn().mockResolvedValue([]),
  }
}
