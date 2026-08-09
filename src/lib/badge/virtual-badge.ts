import {
	IMAGE_BYTES,
	IMAGE_CHUNK_COUNT,
	IMAGE_CHUNK_DATA_BYTES,
	IMAGE_CHUNK_WIRE_BYTES,
	base64Encode,
	crc32
} from './protocol';
import type { BadgeTransport } from './transport';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const FIRMWARE_VERSION = 'virtual-badge-1.0';

export interface VirtualBadgeState {
	connected: boolean;
	firmwareVersion: string;
	/** A complete 128×128 one-bit image, or null before the first clear/upload. */
	storedImage: Uint8Array | null;
	receivedChunks: number[];
}

type Reader = {
	resolve: (value: Uint8Array | null) => void;
	reject: (reason: unknown) => void;
	signal?: AbortSignal;
};

/**
 * Browser-local model of the small console contract the companion uses.
 * It deliberately models commands and their replies, not the badge firmware.
 */
export class VirtualBadgeTransport implements BadgeTransport {
	private connected = false;
	private image: Uint8Array | null = null;
	private stagingImage: Uint8Array | null = null;
	private readonly chunks = new Set<number>();
	private readonly incoming: Uint8Array[] = [];
	private readonly readers: Reader[] = [];
	private outgoing = '';

	constructor(private readonly onStateChange?: (state: VirtualBadgeState) => void) {}

	get state(): VirtualBadgeState {
		return {
			connected: this.connected,
			firmwareVersion: FIRMWARE_VERSION,
			storedImage: this.image?.slice() ?? null,
			receivedChunks: [...this.chunks].sort((first, second) => first - second)
		};
	}

	async connect(): Promise<void> {
		this.connected = true;
		this.notifyState();
	}

	async write(bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
		throwIfAborted(signal);
		if (!this.connected) throw new Error('Virtual badge is not connected. Call connect() first.');

		this.outgoing += decoder.decode(bytes);
		let newline: number;
		while ((newline = this.outgoing.indexOf('\n')) !== -1) {
			let command = this.outgoing.slice(0, newline);
			this.outgoing = this.outgoing.slice(newline + 1);
			if (command.endsWith('\r')) command = command.slice(0, -1);
			if (!command) {
				this.enqueue(encoder.encode('Commands: echo, ver, test, image, bio\n'));
				continue;
			}
			const response = this.handleCommand(command, true);
			this.enqueue(encoder.encode(`[console] ${command}\n${response}\n`));
		}
	}

	read(signal?: AbortSignal): Promise<Uint8Array | null> {
		if (signal?.aborted) return Promise.reject(abortError());
		const next = this.incoming.shift();
		if (next) return Promise.resolve(next);
		if (!this.connected) return Promise.resolve(null);

		return new Promise((resolve, reject) => {
			const reader: Reader = { resolve, reject, signal };
			this.readers.push(reader);
			if (!signal) return;
			signal.addEventListener(
				'abort',
				() => {
					const index = this.readers.indexOf(reader);
					if (index !== -1) this.readers.splice(index, 1);
					reject(abortError());
				},
				{ once: true }
			);
		});
	}

	async close(): Promise<void> {
		if (!this.connected) return;
		this.connected = false;
		this.notifyState();
		while (this.readers.length > 0) this.readers.shift()?.resolve(null);
	}

	private handleCommand(command: string, correctlyFramed: boolean): string {
		if (!correctlyFramed) return 'ERR';
		if (command === 'ver xous') return `Xous version: ${FIRMWARE_VERSION}`;
		if (command === 'test hw') return '_|TT|_HW.PASS,_|TE|_\nXous version: ' + FIRMWARE_VERSION;
		if (command === 'image clear') {
			this.image = null;
			this.stagingImage = new Uint8Array(IMAGE_BYTES);
			this.chunks.clear();
			this.notifyState();
			return 'CLEAR';
		}

		const chunk = parseImageChunk(command);
		if (!chunk) return 'ERR';
		if (chunk.index === 0) {
			this.stagingImage = new Uint8Array(IMAGE_BYTES);
			this.chunks.clear();
		}
		if (!this.stagingImage) return 'ERR';
		this.stagingImage.set(chunk.data, chunk.index * IMAGE_CHUNK_DATA_BYTES);
		this.chunks.add(chunk.index);
		if (this.chunks.size === IMAGE_CHUNK_COUNT) this.image = this.stagingImage.slice();
		this.notifyState();
		return this.chunks.size === IMAGE_CHUNK_COUNT ? 'SUCCESS' : 'OK';
	}

	private enqueue(chunk: Uint8Array): void {
		const reader = this.readers.shift();
		if (reader) reader.resolve(chunk);
		else this.incoming.push(chunk);
	}

	private notifyState(): void {
		this.onStateChange?.(this.state);
	}
}

function parseImageChunk(command: string): { index: number; data: Uint8Array } | null {
	if (!command.startsWith('image ')) return null;
	const encoded = command.slice('image '.length);
	if (!encoded || /\s/.test(encoded)) return null;

	let bytes: Uint8Array;
	try {
		const binary = atob(encoded);
		bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	} catch {
		return null;
	}
	if (base64Encode(bytes) !== encoded || bytes.byteLength !== IMAGE_CHUNK_WIRE_BYTES) return null;

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const index = view.getUint16(0, false);
	const actualCrc = view.getUint32(2 + IMAGE_CHUNK_DATA_BYTES, false);
	if (index >= IMAGE_CHUNK_COUNT || actualCrc !== crc32(bytes.subarray(0, 2 + IMAGE_CHUNK_DATA_BYTES))) return null;
	return { index, data: bytes.slice(2, 2 + IMAGE_CHUNK_DATA_BYTES) };
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortError();
}

function abortError(): DOMException {
	return new DOMException('The operation was aborted.', 'AbortError');
}
