import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_CONFIG, type AppConfig } from '../shared/ipc'

// App configuration persisted as a small JSON file in the per-user data dir
// (e.g. %APPDATA%/agent-code/settings.json on Windows). Kept in the main process
// so secrets like the Stitch API key never round-trip through the renderer except
// when the user edits them in the Settings screen.

function configPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** Read the persisted config, merged over defaults (missing keys are filled in). */
export function loadConfig(): AppConfig {
  try {
    const raw = readFileSync(configPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppConfig>
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      stitch: { ...DEFAULT_CONFIG.stitch, ...(parsed.stitch ?? {}) }
    }
  } catch {
    // No file yet / unreadable / invalid JSON → defaults.
    return { ...DEFAULT_CONFIG, stitch: { ...DEFAULT_CONFIG.stitch } }
  }
}

/** Persist the config to disk (best-effort). */
export function saveConfig(cfg: AppConfig): void {
  try {
    writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8')
  } catch {
    /* disk error — settings are best-effort */
  }
}

/**
 * Merge a partial config into what's on disk and persist it. Lets independent
 * settings (Stitch in the Settings modal, "Permitir tudo" in the topbar) be saved
 * separately without clobbering each other. Returns the merged config.
 */
export function updateConfig(patch: Partial<AppConfig>): AppConfig {
  const cur = loadConfig()
  const next: AppConfig = {
    ...cur,
    ...patch,
    stitch: { ...cur.stitch, ...(patch.stitch ?? {}) }
  }
  saveConfig(next)
  return next
}
