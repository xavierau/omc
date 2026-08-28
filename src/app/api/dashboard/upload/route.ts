import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { buildUploadPath, TenantPrefixError } from './upload-path'

const ALLOWED_BUCKETS = [
  'tenant-assets',
  'wa-template-media',
  'campaign-images',
] as const
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

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

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `Invalid file type: ${file.type}. Allowed: JPEG, PNG, WebP.` },
        { status: 400 }
      )
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File exceeds 5MB limit.' },
        { status: 400 }
      )
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
