import { PhoneNumber } from '@/domain/value-objects/phone-number'
import { E164Phone } from '@/domain/value-objects/e164-phone'
import { parseE164Phone } from '@/infrastructure/phone/e164-parser'

/**
 * G-3 (WI-14/WI-16, grok review) / N-8 (WI-17 confirmation review): WI-7's
 * seam refactor wraps the legacy `PhoneNumber` VO's output in `E164Phone.of`
 * -- a STRICT format assertion (`^\+[1-9]\d{7,14}$`). `PhoneNumber.create`
 * only strips `[\s\-()]`; it keeps dots and other characters, which a
 * pre-seam insert never validated this strictly. A phone in a format the
 * legacy VO accepted (e.g. containing a dot) used to throw uncaught inside
 * `E164Phone.of`, 500-ing the WhatsApp join / web QR join, or -- the N-8 gap
 * this file was extracted to close -- getting misclassified as a
 * `duplicate_active` CSV-import rejection instead of being imported.
 *
 * Fix: try the strict path first (preserves 100% of today's behaviour and
 * DB-lookup compatibility for the overwhelmingly common clean-input case);
 * only on failure, fall back to `parseE164Phone` -- the SAME
 * libphonenumber-backed parser the partner API path (T-C2) already uses --
 * to repair the legacy-accepted format into a valid E.164 instead of
 * crashing.
 *
 * If that ALSO fails (a fast-check property suite over `PhoneNumber`'s own
 * accepted grammar -- 8-15 digits, any other characters tolerated -- found
 * this: a legacy-accepted value containing a letter, or one with a
 * leading-zero digit run, fails BOTH `E164Phone.of` and `parseE164Phone`),
 * the number is genuinely unresolvable. Re-thrown in `PhoneNumber.create`'s
 * OWN error shape (`Invalid phone number: ...`) -- not `E164Phone`'s
 * internal assertion message -- so every caller's EXISTING error handling
 * still recognises it: the web join route's `message.includes('Invalid
 * phone')` -> 400 mapping, the WhatsApp handler's catch-all, and (N-8) the
 * CSV importer's own `invalid_phone` reject reason.
 *
 * Originally two near-identical copies (register-member.ts,
 * register-member-web.ts, both still re-export this same function under
 * their own name so existing importers -- including the property-suite
 * test -- are unaffected). Extracted here on the THIRD occurrence (N-8:
 * import-contacts-batch-row-member.ts needed the identical fallback) per
 * this repo's own DRY rule -- three near-identical copies of
 * correctness-sensitive phone-resolution logic is exactly how the CSV path
 * was missed by WI-14/WI-16 in the first place.
 */
export function resolveLegacyMemberE164(phone: PhoneNumber): E164Phone {
  try {
    return E164Phone.of(phone.value)
  } catch {
    const parsed = parseE164Phone(phone.value)
    if (parsed instanceof E164Phone) return parsed
    throw new Error(`Invalid phone number: ${phone.value}`)
  }
}
