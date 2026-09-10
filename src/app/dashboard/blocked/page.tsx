export default function BlockedPage() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background">
      <div className="text-center space-y-3 max-w-md px-4">
        <h1 className="text-2xl font-semibold text-foreground">
          Your trial has expired
        </h1>
        <p className="text-muted-foreground">
          Please contact us to continue using the platform.
        </p>
      </div>
    </div>
  )
}
