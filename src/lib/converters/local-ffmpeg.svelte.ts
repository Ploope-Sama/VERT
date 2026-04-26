/**
 * LocalFfmpegConverter
 *
 * Converts video files using the system FFmpeg binary (if installed).
 * Only active inside the Tauri desktop build; in a browser it stays
 * "not-ready" and is silently bypassed in favour of VertdConverter.
 *
 * Pipeline:
 *   1. Write the input File to a temp path via tauri-plugin-fs
 *   2. Invoke the Rust `ffmpeg_convert` command
 *   3. Rust runs FFmpeg, emits `ffmpeg-progress` events while it works
 *   4. Read the output file back via tauri-plugin-fs
 *   5. Delete both temp files
 */

import { Converter, FormatInfo } from "./converter.svelte";
import { VertFile } from "$lib/types";
import { isTauri } from "$lib/util/tauri";
import { m } from "$lib/paraglide/messages";

// ─── Supported formats (same set as VertdConverter) ──────────────────────────

const VIDEO_FORMATS: FormatInfo[] = [
	new FormatInfo("mkv", true, true),
	new FormatInfo("mp4", true, true),
	new FormatInfo("webm", true, true),
	new FormatInfo("avi", true, true),
	new FormatInfo("wmv", true, true),
	new FormatInfo("mov", true, true),
	new FormatInfo("gif", true, true),
	new FormatInfo("mts", true, true),
	new FormatInfo("ts", true, true),
	new FormatInfo("m2ts", true, true),
	new FormatInfo("mpg", true, true),
	new FormatInfo("mpeg", true, true),
	new FormatInfo("flv", true, true),
	new FormatInfo("f4v", true, true),
	new FormatInfo("vob", true, true),
	new FormatInfo("m4v", true, true),
	new FormatInfo("3gp", true, true),
	new FormatInfo("3g2", true, true),
	new FormatInfo("mxf", true, true),
	new FormatInfo("ogv", true, true),
	new FormatInfo("rm", true, false),
	new FormatInfo("rmvb", true, false),
	new FormatInfo("h264", true, true),
	new FormatInfo("divx", true, true),
	new FormatInfo("swf", true, true),
	new FormatInfo("amv", true, true),
	new FormatInfo("asf", true, true),
	new FormatInfo("nut", true, true),
];

// ─── Converter class ─────────────────────────────────────────────────────────

export class LocalFfmpegConverter extends Converter {
	public name = "local-ffmpeg";
	public reportsProgress = true;

	/** All video formats are always declared so that the UI can show them.
	 *  The converter is only *chosen* at convert-time when status === "ready". */
	public supportedFormats: FormatInfo[] = VIDEO_FORMATS;

	/** file_id → unlisten function (to clean up event listeners on cancel) */
	private activeUnlisteners = new Map<string, () => void>();

	constructor() {
		super(30); // allow 30 s for async FFmpeg detection before timing out
		this.init();
	}

	private async init(): Promise<void> {
		if (!isTauri) {
			this.status = "not-ready";
			this.clearTimeout();
			return;
		}

		try {
			const { invoke } = await import("@tauri-apps/api/core");
			const found = await invoke<boolean>("detect_ffmpeg");
			this.status = found ? "ready" : "not-ready";
		} catch {
			this.status = "not-ready";
		}

		this.clearTimeout();
	}

	// ── convert ──────────────────────────────────────────────────────────────

	public async convert(input: VertFile, to: string): Promise<VertFile> {
		if (!isTauri) throw new Error("Local FFmpeg is only available in the desktop app");
		if (this.status !== "ready") throw new Error("FFmpeg is not available on this system");

		if (to.startsWith(".")) to = to.slice(1);

		const { invoke } = await import("@tauri-apps/api/core");
		const { listen } = await import("@tauri-apps/api/event");
		const { writeFile, readFile, remove } = await import("@tauri-apps/plugin-fs");
		const { join, tempDir } = await import("@tauri-apps/api/path");

		const tmp = await tempDir();
		const inputExt = input.from.replace(/^\./, "");
		const inputPath = await join(tmp, `vert_${input.id}_in.${inputExt}`);
		const outputPath = await join(tmp, `vert_${input.id}_out.${to}`);

		// ── Write input file to temp dir ──────────────────────────────────
		const inputData = new Uint8Array(await input.file.arrayBuffer());
		await writeFile(inputPath, inputData);

		// ── Listen for progress events from Rust ─────────────────────────
		const unlisten = await listen<{ file_id: string; percent: number }>(
			"ffmpeg-progress",
			(event) => {
				if (event.payload.file_id !== input.id) return;
				const pct = event.payload.percent;
				if (pct >= 0) input.progress = pct;
			},
		);
		this.activeUnlisteners.set(input.id, unlisten);

		try {
			await invoke("ffmpeg_convert", {
				fileId: input.id,
				inputPath,
				outputPath,
			});

			input.progress = 100;

			// ── Read output file from temp dir ────────────────────────────
			const outputData = await readFile(outputPath);
			const baseName = input.file.name.replace(/\.[^/.]+$/, "");
			const outputFile = new File(
				[new Uint8Array(outputData)],
				`${baseName}.${to}`,
			);

			return new VertFile(outputFile, to);
		} catch (err) {
			if (String(err) === "cancelled") {
				throw new Error(m["workers.errors.cancel"]({ file: input.name, message: "cancelled" }));
			}
			throw new Error(String(err));
		} finally {
			// ── Clean up listener and temp files ─────────────────────────
			unlisten();
			this.activeUnlisteners.delete(input.id);

			try { await remove(inputPath); } catch { /* ignore */ }
			try { await remove(outputPath); } catch { /* ignore */ }
		}
	}

	// ── cancel ───────────────────────────────────────────────────────────────

	public async cancel(input: VertFile): Promise<void> {
		// Stop listening for progress events
		const unlisten = this.activeUnlisteners.get(input.id);
		if (unlisten) {
			unlisten();
			this.activeUnlisteners.delete(input.id);
		}

		if (!isTauri) return;
		const { invoke } = await import("@tauri-apps/api/core");
		await invoke("ffmpeg_cancel", { fileId: input.id });
	}
}
