import { Sidebar } from '@/components/dashboard/sidebar'
import { TenantProvider } from '@/components/providers/tenant-provider'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <TenantProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 bg-background p-6 pl-16 lg:pl-8 lg:p-8 overflow-auto">
          {children}
        </main>
      </div>
    </TenantProvider>
  )
}
