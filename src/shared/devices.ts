// Catalog of Android device presets for the preview frame. Each model's portrait
// screen resolution (px) + density is applied to the emulator (adb wm size/density)
// so the preview shows that device's real screen size, wrapped in a bezel.
// Shared between the renderer (selector + frame) and main (applying the size).

export type DeviceType = 'phone' | 'tablet'

export interface AndroidDeviceModel {
  id: string
  name: string
  type: DeviceType
  /** Portrait screen size in physical pixels. */
  width: number
  height: number
  /** Screen density (dpi) — applied with `wm density`. */
  dpi: number
}

export const ANDROID_DEVICES: AndroidDeviceModel[] = [
  // ----- phones (most-used / representative screen sizes) -----
  { id: 's26-ultra', name: 'Galaxy S26 Ultra', type: 'phone', width: 1440, height: 3120, dpi: 505 },
  { id: 's24-ultra', name: 'Galaxy S24 Ultra', type: 'phone', width: 1440, height: 3120, dpi: 501 },
  { id: 's24', name: 'Galaxy S24', type: 'phone', width: 1080, height: 2340, dpi: 416 },
  { id: 'a55', name: 'Galaxy A55', type: 'phone', width: 1080, height: 2340, dpi: 390 },
  { id: 'pixel-8-pro', name: 'Pixel 8 Pro', type: 'phone', width: 1344, height: 2992, dpi: 489 },
  { id: 'pixel-8', name: 'Pixel 8', type: 'phone', width: 1080, height: 2400, dpi: 428 },
  { id: 'oneplus-12', name: 'OnePlus 12', type: 'phone', width: 1440, height: 3168, dpi: 510 },
  { id: 'redmi-note-13', name: 'Redmi Note 13', type: 'phone', width: 1080, height: 2400, dpi: 395 },
  { id: 'moto-g84', name: 'Moto G84', type: 'phone', width: 1080, height: 2400, dpi: 393 },
  { id: 'compact', name: 'Compacto (FHD+)', type: 'phone', width: 1080, height: 2340, dpi: 420 },
  // ----- tablets -----
  { id: 'tab-s9', name: 'Galaxy Tab S9', type: 'tablet', width: 1600, height: 2560, dpi: 274 },
  { id: 'pixel-tablet', name: 'Pixel Tablet', type: 'tablet', width: 1600, height: 2560, dpi: 276 },
  { id: 'tab-a9-plus', name: 'Galaxy Tab A9+', type: 'tablet', width: 1200, height: 1920, dpi: 206 },
  { id: 'lenovo-p11', name: 'Lenovo Tab P11', type: 'tablet', width: 1200, height: 2000, dpi: 220 }
]

export const DEFAULT_DEVICE_ID = 's26-ultra'

export function findDevice(id: string): AndroidDeviceModel | undefined {
  return ANDROID_DEVICES.find((d) => d.id === id)
}
