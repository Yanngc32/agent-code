import type { BrowserInput } from '../../shared/ipc'
import { AndroidDevice } from './androidDevice'
import type { Progress } from './androidEnv'

/**
 * Android half of a preview tab — boot a device/emulator and map panel input
 * (touch/scroll/keys) onto it. Kept separate from BrowserController so the
 * controller only orchestrates tabs while device specifics live here.
 */

/** Create and boot a device/emulator (throws if the toolchain isn't installed). */
export async function bootAndroidDevice(progress: Progress = () => undefined): Promise<AndroidDevice> {
  const device = new AndroidDevice()
  await device.ensureBooted(progress)
  return device
}

/** Map a panel input event onto the Android device (touch/scroll/keys). */
export async function forwardAndroidInput(device: AndroidDevice, ev: BrowserInput): Promise<void> {
  try {
    if (ev.type === 'click') await device.tap(ev.nx, ev.ny)
    else if (ev.type === 'wheel') await device.wheel(ev.nx, ev.ny, ev.dy)
    else if (ev.type === 'key') await device.sendKeyName(ev.key, ev.text)
    // 'move' has no touch equivalent — ignored.
  } catch {
    /* ignore transient adb errors */
  }
}
