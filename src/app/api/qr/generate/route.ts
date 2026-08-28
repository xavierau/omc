import { NextResponse } from 'next/server'
import { generateQr } from '@/application/generate-qr'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

async function fetchWhatsappNumber(
  restaurantId: string
): Promise<string | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select('whatsapp_number')
    .eq('id', restaurantId)
    .single()

  if (error || !data?.whatsapp_number) return null
  return data.whatsapp_number
}

export async function POST() {
  try {
    const { restaurantId } = await getTenantContext()
    const whatsappNumber = await fetchWhatsappNumber(restaurantId)
    if (!whatsappNumber) {
      return NextResponse.json(
        { error: 'Restaurant not found or missing WhatsApp number' },
        { status: 404 }
      )
    }

    const result = await generateQr({ whatsappNumber })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('QR generation error:', error)
    return NextResponse.json(
      { error: 'Failed to generate QR code' },
      { status: 500 }
    )
  }
}
