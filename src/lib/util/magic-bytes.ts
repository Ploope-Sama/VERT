/**
 * Magic bytes (file signature) detection.
 *
 * Reads the first bytes of a File/Blob and returns the most likely
 * MIME type and canonical extension, regardless of what the filename says.
 *
 * This fixes the classic "HEIC → JPG converter outputs a file whose bytes
 * are actually PNG, but the extension says .jpg" problem.
 */

interface MagicSignature {
	/** Byte offset from the start of the file */
	offset: number;
	/** Expected bytes at that offset */
	bytes: number[];
	/** Canonical MIME type */
	mime: string;
	/** Canonical extension (without leading dot) */
	ext: string;
}

// Sorted longest-match first so more specific rules win.
const SIGNATURES: MagicSignature[] = [
	// PNG  — 8-byte magic
	{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], mime: "image/png",  ext: "png"  },
	// JPEG — 3-byte SOI + APP marker
	{ offset: 0, bytes: [0xff, 0xd8, 0xff],                                 mime: "image/jpeg", ext: "jpg"  },
	// GIF87a / GIF89a
	{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],              mime: "image/gif",  ext: "gif"  },
	{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],              mime: "image/gif",  ext: "gif"  },
	// WebP — "RIFF" at 0 + "WEBP" at 8
	{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46],                          mime: "image/webp", ext: "webp" },
	// BMP
	{ offset: 0, bytes: [0x42, 0x4d],                                       mime: "image/bmp",  ext: "bmp"  },
	// TIFF little-endian / big-endian
	{ offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00],                          mime: "image/tiff", ext: "tiff" },
	{ offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a],                          mime: "image/tiff", ext: "tiff" },
	// AVIF / HEIC / HEIF — ISO Base Media file format (ftyp box)
	// Bytes 4-7 are "ftyp"; brand at bytes 8-11 tells us more.
	{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], mime: "image/avif", ext: "avif" },
	{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], mime: "image/heic", ext: "heic" },
	{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x78], mime: "image/heic", ext: "heic" },
	{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31], mime: "image/heif", ext: "heif" },
	// ISOBMFF generic — just "ftyp"
	{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70],                          mime: "video/mp4",  ext: "mp4"  },
	// MP4 — "ftyp" already covered above; also check for moov atom
	// PDF
	{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46],                          mime: "application/pdf", ext: "pdf" },
	// ZIP (also base for .docx/.xlsx/.odt etc)
	{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04],                          mime: "application/zip", ext: "zip" },
	// OGG
	{ offset: 0, bytes: [0x4f, 0x67, 0x67, 0x53],                          mime: "audio/ogg",  ext: "ogg"  },
	// FLAC
	{ offset: 0, bytes: [0x66, 0x4c, 0x61, 0x43],                          mime: "audio/flac", ext: "flac" },
	// MP3 with ID3 tag
	{ offset: 0, bytes: [0x49, 0x44, 0x33],                                 mime: "audio/mpeg", ext: "mp3"  },
	// WAV — "RIFF" at 0 + "WAVE" at 8
	{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46],                          mime: "audio/wav",  ext: "wav"  },
	// AIFF
	{ offset: 0, bytes: [0x46, 0x4f, 0x52, 0x4d],                          mime: "audio/aiff", ext: "aiff" },
	// WEBM / MKV
	{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3],                          mime: "video/webm", ext: "webm" },
];

// How many bytes we need to read from the file (max offset + max bytes length)
const READ_BYTES = 16;

/**
 * Returns `{ mime, ext }` if magic bytes are recognised, otherwise `null`.
 */
export async function detectMimeType(
	file: File,
): Promise<{ mime: string; ext: string } | null> {
	try {
		const slice = file.slice(0, READ_BYTES);
		const buffer = await slice.arrayBuffer();
		const bytes = new Uint8Array(buffer);

		// Sort by most-specific (longest signature) first
		const sorted = [...SIGNATURES].sort(
			(a, b) => b.bytes.length - a.bytes.length,
		);

		for (const sig of sorted) {
			const { offset, bytes: expected } = sig;
			if (offset + expected.length > bytes.length) continue;
			const matches = expected.every(
				(b, i) => bytes[offset + i] === b,
			);
			if (matches) {
				// Extra check for RIFF container: distinguish WAV vs WebP
				if (sig.mime === "audio/wav" || sig.mime === "image/webp") {
					const subtype = String.fromCharCode(
						bytes[8], bytes[9], bytes[10], bytes[11],
					);
					if (sig.mime === "image/webp" && subtype !== "WEBP") continue;
					if (sig.mime === "audio/wav"  && subtype !== "WAVE") continue;
				}
				return { mime: sig.mime, ext: sig.ext };
			}
		}
	} catch {
		// Silently ignore — fall back to extension-based detection
	}
	return null;
}

/**
 * Given a File, returns the correct lowercase extension (with leading dot)
 * based on magic bytes, falling back to the filename extension.
 *
 * Example: a PNG file named "photo.jpg" will return ".png"
 */
export async function correctExtension(file: File): Promise<string> {
	const detected = await detectMimeType(file);
	if (detected) {
		const extFromName = ("." + (file.name.split(".").pop() ?? "")).toLowerCase();
		const detectedExt = "." + detected.ext;

		// Only override if there is a real mismatch worth fixing
		if (extFromName !== detectedExt && isImageMismatch(extFromName, detectedExt)) {
			return detectedExt;
		}
	}
	return ("." + (file.name.split(".").pop() ?? "")).toLowerCase();
}

/**
 * Returns true when swapping from `declared` → `real` is safe and meaningful.
 * Avoids false positives like treating every ZIP-based format (docx, xlsx…)
 * as a plain .zip.
 */
function isImageMismatch(declared: string, real: string): boolean {
	const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".tif", ".heic", ".heif", ".avif"]);
	// Only correct within the image family — don't rename .docx → .zip etc.
	return IMAGE_EXTS.has(declared) || IMAGE_EXTS.has(real);
}
