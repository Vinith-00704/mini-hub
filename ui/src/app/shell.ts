// What only the desktop app can do for the dashboard: Windows' own save and open windows for a backup. The shell
// returns the chosen path, or nothing when the person cancels. Outside the desktop app (development) there is none.

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

const tauriInvoke: Invoke = async (command, args) => (await import('@tauri-apps/api/core')).invoke(command, args)

/** Whether this window is the desktop app's own. */
export const inShell = (): boolean => '__TAURI_INTERNALS__' in window

const path = (answer: unknown): string | null => (typeof answer === 'string' && answer !== '' ? answer : null)

/** Windows' save window, starting with `name`. The chosen path, or null when cancelled. */
export async function pickSave(name: string, invoke: Invoke = tauriInvoke): Promise<string | null> {
  return path(await invoke('pick_backup_save', { suggested: name }))
}

/** Windows' open window for a backup. The chosen path, or null when cancelled. */
export async function pickOpen(invoke: Invoke = tauriInvoke): Promise<string | null> {
  return path(await invoke('pick_backup_open'))
}
