import { browser } from "$app/environment";

export const isTauri = browser && "__TAURI_INTERNALS__" in window;

export async function getAppVersion(): Promise<string | null> {
	if (!isTauri) return null;
	try {
		const { getVersion } = await import("@tauri-apps/api/app");
		return await getVersion();
	} catch {
		return null;
	}
}

export async function checkForUpdates(): Promise<void> {
	if (!isTauri) return;
	try {
		const { check } = await import("@tauri-apps/plugin-updater");
		const update = await check();
		if (update) {
			await update.downloadAndInstall();
		}
	} catch {
		// updater not configured yet — silent fail
	}
}

/**
 * Opens a native folder-picker dialog and returns the chosen path,
 * or null if the user cancelled.  Only works in Tauri.
 */
export async function pickFolder(title?: string): Promise<string | null> {
	if (!isTauri) return null;
	try {
		const { open } = await import("@tauri-apps/plugin-dialog");
		const result = await open({
			directory: true,
			multiple: false,
			title: title ?? "Choose a folder",
		});
		return typeof result === "string" ? result : null;
	} catch {
		return null;
	}
}

/**
 * Writes `data` to `filePath` using the native fs plugin.
 * Creates parent directories if needed.  Only works in Tauri.
 */
export async function saveFileTo(
	filePath: string,
	data: Uint8Array,
): Promise<void> {
	const { writeFile, mkdir } = await import("@tauri-apps/plugin-fs");
	const { dirname } = await import("@tauri-apps/api/path");
	const dir = await dirname(filePath);
	// ensure directory exists (ignore error if it already does)
	try {
		await mkdir(dir, { recursive: true });
	} catch { /* already exists */ }
	await writeFile(filePath, data);
}
