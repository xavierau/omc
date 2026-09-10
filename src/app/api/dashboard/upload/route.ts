import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { buildUploadPath, TenantPrefixError } from './upload-path'
import { checkUploadPolicy } from './upload-policy'

const ALLOWED_BUCKETS = [
  'tenant-assets',
  'wa-template-media',
  'campaign-images',
] as const

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const bucket = request.nextUrl.searchParams.get('bucket')

    if (!bucket || !ALLOWED_BUCKETS.includes(bucket as typeof ALLOWED_BUCKETS[number])) {
      return NextResponse.json({ error: 'Invalid bucket' }, { status: 400 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const policyViolation = checkUploadPolicy({ bucket, mime: file.type, size: file.size })
    if (policyViolation) {
      return NextResponse.json({ error: policyViolation.error }, { status: 400 })
    }

    const explicitPath = formData.get('path')
    const path = buildUploadPath({
      restaurantId,
      explicitPath: typeof explicitPath === 'string' ? explicitPath : null,
      mime: file.type,
    })
    const buffer = Buffer.from(await file.arrayBuffer())

    const supabase = createServerSupabaseClient()

    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, buffer, { contentType: file.type, upsert: true })

    if (error) {
      throw new Error(`Upload failed: ${error.message}`)
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(path)

    return NextResponse.json({ url: data.publicUrl })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    if (error instanceof TenantPrefixError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    )
  }
}
