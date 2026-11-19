/**
 * BOOK-003 (R31): the code a diner sends on WhatsApp to prove the booking
 * phone is theirs.
 *
 * Six characters from an alphabet without 0/O/1/I, with at least one digit so
 * an ordinary six-letter word ("THANKS") is never a candidate and the webhook
 * adds a lookup only to messages that can carry a code (plan perf budget).
 * Matching is case-insensitive: the diner may retype it in lower case.
 */
export const CONFIRM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export const CONFIRM_CODE_LENGTH = 6
/** A message names at most this many candidate codes; extra tokens are ignored. */
export const MAX_CODE_CANDIDATES = 3

const CODE_SHAPE = new RegExp(`^[${CONFIRM_CODE_ALPHABET}]{${CONFIRM_CODE_LENGTH}}$`)
const HAS_DIGIT = /[2-9]/

export function isConfirmCode(value: string): boolean {
  return CODE_SHAPE.test(value) && HAS_DIGIT.test(value)
}

/**
 * `randomIndex(n)` returns a uniform integer in [0, n) from a CSPRNG
 * (crypto.randomInt in production). Redraws until the code holds a digit.
 */
export function generateConfirmCode(randomIndex: (n: number) => number): string {
  for (;;) {
    let code = ''
    for (let i = 0; i < CONFIRM_CODE_LENGTH; i++) code += CONFIRM_CODE_ALPHABET[randomIndex(CONFIRM_CODE_ALPHABET.length)]
    if (isConfirmCode(code)) return code
  }
}

/**
 * The distinct code-shaped tokens in an inbound text, upper-cased, LAST few
 * only: the prefilled text ends with the code after the restaurant name
 * (buildConfirmText), so a name full of code-like words ("2NDFLR B2CAFE")
 * can never push the real code out (review F5).
 */
export function extractConfirmCodeCandidates(text: string): string[] {
  const tokens = text.toUpperCase().match(/[A-Z0-9]+/g) ?? []
  const codes = tokens.filter(isConfirmCode)
  return [...new Set(codes)].slice(-MAX_CODE_CANDIDATES)
}
