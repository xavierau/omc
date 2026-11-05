import { AdminSidebar } from '@/components/admin/admin-sidebar'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen">
      <AdminSidebar />
      <main className="flex-1 bg-background p-6 pl-16 lg:pl-8 lg:p-8 overflow-auto">
        {children}
      </main>
    </div>
  )
}
