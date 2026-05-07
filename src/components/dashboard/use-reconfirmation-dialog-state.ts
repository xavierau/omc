'use client'

import { useState } from 'react'

export interface ReconfirmationDialogState {
  name: string
  setName: (v: string) => void
}

export function useReconfirmationDialogState(): ReconfirmationDialogState {
  const [name, setName] = useState('')
  return { name, setName }
}
