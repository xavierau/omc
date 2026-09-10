// Scan box sized relative to the viewfinder so it fills most of the camera
// view on any device (customer feedback: fixed 250px box read as "scanner
// too small" on phones). html5-qrcode evaluates this once at scanner start;
// QrScanner restarts on viewport changes to pick up fresh geometry.
// 50px is the library's minimum qrbox.
const QRBOX_RATIO = 0.8
const MIN_QRBOX = 50

export function computeQrbox(viewfinderWidth: number, viewfinderHeight: number) {
  const size = Math.max(
    MIN_QRBOX,
    Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * QRBOX_RATIO)
  )
  return { width: size, height: size }
}

export const QR_CONFIG = { fps: 10, qrbox: computeQrbox }

// Debounced so browser-chrome show/hide and rotation animations don't
// restart the camera repeatedly while the viewport settles. Width-compared
// because iOS Safari fires resize on scroll (chrome collapse) with the width
// unchanged — only a width change can alter the scanner's geometry (the
// container is width-driven: mx-auto max-w-[400px] aspect-square).
const VIEWPORT_SETTLE_MS = 500

type ViewportTarget = EventTarget & { innerWidth: number }

export function watchViewportChange(target: ViewportTarget, onChange: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastWidth = target.innerWidth
  const handler = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (target.innerWidth === lastWidth) return
      lastWidth = target.innerWidth
      onChange()
    }, VIEWPORT_SETTLE_MS)
  }
  target.addEventListener('resize', handler)
  target.addEventListener('orientationchange', handler)
  return () => {
    clearTimeout(timer)
    target.removeEventListener('resize', handler)
    target.removeEventListener('orientationchange', handler)
  }
}
