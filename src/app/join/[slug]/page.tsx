import { notFound } from 'next/navigation'
import { findBySlug } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { SlugJoinForm } from './join-form'

export default async function SlugJoinPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const restaurant = await findBySlug(slug)

  if (!restaurant) {
    notFound()
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <SlugJoinForm slug={slug} tenantName={restaurant.name} logoUrl={restaurant.logo_url} />
    </main>
  )
}
