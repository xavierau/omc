import { FakeClock, SequenceNonce } from '@/test-utils/fake-clock'
import { systemClock, systemNonceSource } from '@/infrastructure/clock/system-clock'
import { runClockContract, runNonceSourceContract } from './clock-nonce.contract'

runClockContract('fake: FakeClock', () => new FakeClock())
runClockContract('real: systemClock', () => systemClock)

runNonceSourceContract('fake: SequenceNonce', () => new SequenceNonce())
runNonceSourceContract('real: systemNonceSource', () => systemNonceSource)
