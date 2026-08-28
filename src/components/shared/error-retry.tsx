import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

interface ErrorRetryProps {
  message?: string
  onRetry: () => void
}

export function ErrorRetry({ message, onRetry }: ErrorRetryProps) {
  const t = useTranslations('common')
  return (
    <div className="flex flex-col items-center py-8 text-center">
      <p className="text-muted-foreground">{message || t('somethingWentWrong')}</p>
      <Button variant="outline" onClick={onRetry} className="mt-3">
        {t('tryAgain')}
      </Button>
    </div>
  )
}
