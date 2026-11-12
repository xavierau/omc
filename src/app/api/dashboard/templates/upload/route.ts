import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

const BUCKET_NAME = 'receipt-samples'
const ALLOWED_TYPES = ['image/jpeg', 'image/png']
const MAX_FILE_SIZE = 5 * 1024 * 1024

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const formData = await request.formData()
    const files = formData.getAll('images') as File[]

    if (files.length === 0) {
      return NextResponse.json({ error: 'No images provided' }, { status: 400 })
    }

    validateFiles(files)

    const supabase = createServerSupabaseClient()
    const urls = await uploadAll(supabase, files, restaurantId)

    return NextResponse.json({ urls })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    const message = error instanceof Error ? error.message : 'Upload failed'
    const status = message.includes('Invalid') ? 400 : 500
    console.error('Template upload error:', error)
    return NextResponse.json({ error: message }, { status })
  }
}

function validateFiles(files: File[]): void {
  for (const file of files) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      throw new Error(`Invalid file type: ${file.type}. Only JPEG and PNG allowed.`)
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File ${file.name} exceeds 5MB limit.`)
    }
  }
}

async function uploadAll(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  files: File[],
  restaurantId: string
): Promise<string[]> {
  const timestamp = Date.now()
  const urls: string[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const ext = file.type === 'image/png' ? 'png' : 'jpg'
    const path = `${restaurantId}/${timestamp}-${i}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(path, buffer, { contentType: file.type, upsert: true })

    if (error) throw new Error(`Upload failed: ${error.message}`)

    const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(path)
    urls.push(data.publicUrl)
  }

  return urls
}
