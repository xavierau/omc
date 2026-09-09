import { afterAll, beforeAll } from 'vitest'
import { FakeOutboundSender } from '@/test-utils/fake-outbound-sender'
import { createLoopbackTestGuard, startLoopbackHttpsServer } from '@/test-utils/loopback-test-guard'
import { runOutboundSenderContract } from './outbound-sender.contract'
import { UndiciOutboundSender } from '../outbound-webhook-sender'

runOutboundSenderContract('fake: FakeOutboundSender', () => new FakeOutboundSender())

// Real adapter (WI-5): a loopback HTTPS server started once for the whole
// file via beforeAll, then dialled through UndiciOutboundSender pinned to
// it via createLoopbackTestGuard(). See outbound-sender.contract.ts for why
// the target URL is a thunk rather than a plain string.
let serverPort = 0
let closeServer: (() => Promise<void>) | null = null

beforeAll(async () => {
  const server = await startLoopbackHttpsServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{}')
  })
  serverPort = server.port
  closeServer = server.close
})

afterAll(async () => {
  if (closeServer) await closeServer()
})

runOutboundSenderContract(
  'real: UndiciOutboundSender',
  () => {
    const guard = createLoopbackTestGuard({ allowedPort: serverPort })
    return new UndiciOutboundSender({
      resolve: guard.resolve,
      isAddressAllowed: guard.isAddressAllowed,
      ca: guard.ca,
      allowedPorts: guard.allowedPorts,
    })
  },
  () => `https://partner.example.test:${serverPort}/hook`
)
