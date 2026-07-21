/**
 * Coarse phone/tablet UI detection for photo + layout choices.
 * Prefer this over UA sniffing — width + coarse pointer covers phones well.
 */

export function isPhoneUi(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(max-width: 1023px)').matches;
  } catch {
    return false;
  }
}

/** True when the device likely has a camera / touch photo picker (not a desktop mouse). */
export function prefersNativePhotoCapture(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const narrow = window.matchMedia('(max-width: 1023px)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    return narrow || coarse;
  } catch {
    return false;
  }
}
