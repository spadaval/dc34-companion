export const IMAGE_WIDTH = 128;
export const IMAGE_HEIGHT = 128;
export const IMAGE_BYTES = (IMAGE_WIDTH * IMAGE_HEIGHT) / 8;
export const IMAGE_CHUNK_DATA_BYTES = 64;
export const IMAGE_CHUNK_COUNT = IMAGE_BYTES / IMAGE_CHUNK_DATA_BYTES;
export const IMAGE_CHUNK_WIRE_BYTES = 2 + IMAGE_CHUNK_DATA_BYTES + 4;

export type BadgeResponseKind = 'ok' | 'success' | 'clear' | 'error' | 'echo' | 'version' | 'hardware-pass' | 'hardware-fail' | 'unrelated';

export interface BadgeResponse {
	kind: BadgeResponseKind;
	line: string;
}

/** CRC-32/ISO-HDLC, matching crc32fast and Python's zlib.crc32. */
export function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) {
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

export function createImageChunk(index: number, data: Uint8Array): Uint8Array {
	if (!Number.isInteger(index) || index < 0 || index >= IMAGE_CHUNK_COUNT) {
		throw new RangeError(`Image chunk index must be between 0 and ${IMAGE_CHUNK_COUNT - 1}.`);
	}
	if (data.byteLength !== IMAGE_CHUNK_DATA_BYTES) {
		throw new RangeError(`Image chunk data must contain exactly ${IMAGE_CHUNK_DATA_BYTES} bytes.`);
	}

	const chunk = new Uint8Array(IMAGE_CHUNK_WIRE_BYTES);
	const view = new DataView(chunk.buffer);
	view.setUint16(0, index, false);
	chunk.set(data, 2);
	view.setUint32(2 + IMAGE_CHUNK_DATA_BYTES, crc32(chunk.subarray(0, 2 + IMAGE_CHUNK_DATA_BYTES)), false);
	return chunk;
}

export function base64Encode(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

export function imageChunkCommand(index: number, data: Uint8Array): string {
	return `image ${base64Encode(createImageChunk(index, data))}`;
}

export function classifyResponse(line: string): BadgeResponse {
	const normalized = line.trim();
	if (normalized === 'OK') return { kind: 'ok', line };
	if (normalized === 'SUCCESS') return { kind: 'success', line };
	if (normalized === 'CLEAR') return { kind: 'clear', line };
	if (normalized === 'ERR') return { kind: 'error', line };
	if (normalized.startsWith('[console]')) return { kind: 'echo', line };
	if (/^Xous version:\s*/i.test(normalized)) return { kind: 'version', line };
	if (normalized.includes('HW.PASS')) return { kind: 'hardware-pass', line };
	if (normalized.includes('HW.FAIL')) return { kind: 'hardware-fail', line };
	return { kind: 'unrelated', line };
}
