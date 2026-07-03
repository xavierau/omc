// Scan box sized relative to the viewfinder so it fills most of the camera
// view on any device (customer feedback: fixed 250px box read as "scanner
// too small" on phones). html5-qrcode evaluates this once at scanner start;
// it does not recompute on rotation. 50px is the library's minimum qrbox.
const QRBOX_RATIO = 0.8
const MIN_QRBOX = 50

export function computeQrbox(viewfinderWidth: number, viewfinderHeight: number) {
  const size = Math.max(
    MIN_QRBOX,
    Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * QRBOX_RATIO)
  )
  return { width: size, height: size }
}
