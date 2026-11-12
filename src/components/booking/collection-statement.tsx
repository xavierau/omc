/**
 * BOOK-001 R18 (PDPO DPP1): who gets the diner's details, why, and where the
 * privacy policy is. Always shown in both languages, whatever the app
 * locale, because the page is opened from a WhatsApp chat in either.
 * Copy is provisional until the owner approves diner copy (spec OQ7).
 */
export const PRIVACY_URL = process.env.NEXT_PUBLIC_PRIVACY_URL || 'https://ohmyclient.io/privacy'

export function CollectionStatement({ restaurantName }: { restaurantName: string }) {
  return (
    <section data-testid="booking-collection-statement" className="space-y-2 text-xs leading-relaxed text-muted-foreground">
      <p lang="zh-HK">
        你提交的資料(日期、時間、人數、姓名及備註)只會交給{restaurantName},用作處理今次訂座。
        <a href={PRIVACY_URL} className="underline underline-offset-2" rel="noreferrer noopener" target="_blank">
          私隱政策
        </a>
      </p>
      <p lang="en">
        The details you submit (date, time, party size, name and notes) go only to {restaurantName}, to handle this
        booking.{' '}
        <a href={PRIVACY_URL} className="underline underline-offset-2" rel="noreferrer noopener" target="_blank">
          Privacy policy
        </a>
      </p>
    </section>
  )
}
