// BOOK-001 W2: in-memory classifier, classification store and chat-token
// source. The store enforces UNIQUE (restaurant_id, message_id) like 082.
import type { ClassifyResult, IntentClassifierPort } from '@/domain/ports/intent-classifier'
import type {
  InboundClassificationRow,
  InboundClassificationStore,
  RecordClassificationResult,
} from '@/domain/ports/inbound-classification'

export class FakeIntentClassifier implements IntentClassifierPort {
  readonly calls: string[] = []
  constructor(public result: ClassifyResult = { ok: true, label: 'booking', confidence: 0.95 }) {}

  async classify(text: string): Promise<ClassifyResult> {
    this.calls.push(text)
    return this.result
  }
}

export class FakeClassificationStore implements InboundClassificationStore {
  readonly rows: InboundClassificationRow[] = []
  fail = false

  async record(row: InboundClassificationRow): Promise<RecordClassificationResult> {
    if (this.fail) return 'failed'
    const seen = this.rows.some((r) => r.restaurantId === row.restaurantId && r.messageId === row.messageId)
    if (seen) return 'duplicate'
    this.rows.push(row)
    return 'recorded'
  }
}

export interface MintCall {
  restaurantId: string
  phone: string
  ttlHours: number | null
}

export class FakeChatTokens {
  readonly live = new Map<string, string>()
  readonly mints: MintCall[] = []
  failMint = false

  async findLiveChatToken(restaurantId: string, phone: string): Promise<string | null> {
    return this.live.get(`${restaurantId}|${phone}`) ?? null
  }

  async mint(input: MintCall): Promise<string | null> {
    this.mints.push(input)
    if (this.failMint) return null
    const token = `tok${this.mints.length}`.padEnd(43, 'x')
    this.live.set(`${input.restaurantId}|${input.phone}`, token)
    return token
  }
}
