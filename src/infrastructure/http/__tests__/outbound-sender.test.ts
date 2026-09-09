import { FakeOutboundSender } from '@/test-utils/fake-outbound-sender'
import { runOutboundSenderContract } from './outbound-sender.contract'

runOutboundSenderContract('fake: FakeOutboundSender', () => new FakeOutboundSender())

// WI-5 adds a second call here against the real UndiciOutboundSender, dialled
// at a local `node:http` server via `createLoopbackTestGuard()`:
//   runOutboundSenderContract('real: UndiciOutboundSender', async () => { ... })
