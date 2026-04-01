import { SlugJoinForm } from './join-form'

export default async function SlugJoinPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <SlugJoinForm slug={slug} />
    </main>
  )
}
