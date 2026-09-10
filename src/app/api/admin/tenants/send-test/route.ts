import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { sendTestMessage } from '@/application/send-test-message'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429 }
      )
    }

    const body = await request.json()
    if (!body.kapsoPhoneNumberId || typeof body.kapsoPhoneNumberId !== 'string') {
      return NextResponse.json(
        { error: 'kapsoPhoneNumberId is required' },
        { status: 400 }
      )
    }
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(body.kapsoPhoneNumberId)) {
      return NextResponse.json(
        { error: 'Invalid kapsoPhoneNumberId format' },
        { status: 400 }
      )
    }
    if (!body.toNumber || typeof body.toNumber !== 'string') {
      return NextResponse.json(
        { error: 'toNumber is required' },
        { status: 400 }
      )
    }

    const result = await sendTestMessage(body.kapsoPhoneNumberId, body.toNumber)
    return NextResponse.json(result)
  } catch (error) {
    return handleError(error)
  }
}

function handleError(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    )
  }
  console.error('send-test POST error:', error)
  return NextResponse.json(
    { error: 'Internal server error' },
    { status: 500 }
  )
}
