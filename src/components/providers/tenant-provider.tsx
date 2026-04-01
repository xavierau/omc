'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

interface Restaurant {
  id: string
  name: string
  slug: string
  role: string
}

interface TenantContextValue {
  restaurantId: string | null
  restaurantName: string | null
  restaurants: Restaurant[]
  switchTenant: (id: string) => void
}

const TenantContext = createContext<TenantContextValue>({
  restaurantId: null,
  restaurantName: null,
  restaurants: [],
  switchTenant: () => {},
})

export function TenantProvider({ children }: { children: ReactNode }) {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    const cookieId = getCookie('x-tenant-id')
    setActiveId(cookieId)
    fetchTenants().then(setRestaurants).catch(() => {})
  }, [])

  const switchTenant = useCallback((id: string) => {
    document.cookie = `x-tenant-id=${id};path=/;max-age=31536000`
    setActiveId(id)
    window.location.reload()
  }, [])

  const active = restaurants.find((r) => r.id === activeId)

  return (
    <TenantContext.Provider
      value={{
        restaurantId: activeId,
        restaurantName: active?.name ?? null,
        restaurants,
        switchTenant,
      }}
    >
      {children}
    </TenantContext.Provider>
  )
}

export function useTenant() {
  return useContext(TenantContext)
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name}=([^;]*)`)
  )
  return match ? decodeURIComponent(match[1]) : null
}

async function fetchTenants(): Promise<Restaurant[]> {
  const res = await fetch('/api/me/tenants')
  if (!res.ok) return []
  return res.json()
}
