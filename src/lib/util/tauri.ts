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
