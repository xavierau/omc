import { getTranslations } from 'next-intl/server'
import { QrGenerator } from '@/components/dashboard/qr-generator'
import { ReceiptTemplateSection } from '@/components/dashboard/receipt-template-section'
import { FlaggedReceiptsPanel } from '@/components/dashboard/flagged-receipts-panel'
import { Separator } from '@/components/ui/separator'

export default async function SetupPage() {
  const t = await getTranslations('qr')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
        <p className="text-muted-foreground mt-1">{t('description')}</p>
      </div>
      <QrGenerator />

      <Separator />

      <div>
        <h2 className="text-xl font-semibold text-foreground">Receipt Layout Template</h2>
        <p className="text-muted-foreground mt-1">
          Configure how receipt images are verified for layout consistency.
        </p>
      </div>
      <ReceiptTemplateSection />

      <Separator />

      <div>
        <h2 className="text-xl font-semibold text-foreground">Flagged Receipts</h2>
        <p className="text-muted-foreground mt-1">
          Review receipts that failed layout verification.
        </p>
      </div>
      <FlaggedReceiptsPanel />
    </div>
  )
}
