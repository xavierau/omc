import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { uploadConsentProof } from '@/infrastructure/supabase/storage/consent-proof-upload'
import { ProofUploadValidationError } from '@/infrastructure/supabase/storage/__errors__/proof-upload-errors'

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const result = await uploadConsentProof({
      restaurantId,
      file: {
        bytes,
        mimeType: file.type,
        originalName: file.name,
      },
    })

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    return mapError(error)
  }
}

function mapError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    )
  }
  if (error instanceof ProofUploadValidationError) {
    return NextResponse.json(
      { error: error.message, reason: error.reason },
      { status: 400 }
    )
  }
  console.error('Proof upload error:', error)
  const message = error instanceof Error ? error.message : 'Upload failed'
  return NextResponse.json({ error: message }, { status: 500 })
}
