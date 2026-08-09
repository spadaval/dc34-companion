import { LineParser } from './line-parser';
import {
	classifyResponse,
	IMAGE_BYTES,
	IMAGE_CHUNK_COUNT,
	imageChunkCommand,
	type BadgeResponse,
	type BadgeResponseKind
} from './protocol';

export interface BadgeTransport {
	readonly writePacing?: { maxBytes: number; delayMs: number };
	write(bytes: Uint8Array, signal?: AbortSignal): Promise<void>;
	read(signal?: AbortSignal): Promise<Uint8Array | null>;
	close?(): Promise<void>;
}

export interface TransactionOptions {
	timeoutMs?: number;
	maxRetries?: number;
	retryDelayMs?: number;
	signal?: AbortSignal;
	/** Keep consuming accepted intermediate responses until this terminal kind arrives. */
	completeOn?: BadgeResponseKind;
}

export interface TransactionResult {
	response: BadgeResponse;
	attempt: number;
}

export interface UploadOptions extends TransactionOptions {
	onProgress?: (completedChunks: number, totalChunks: number) => void;
	chunkDelayMs?: number;
}

export interface ConsoleCommandOptions {
	timeoutMs?: number;
	idleMs?: number;
	signal?: AbortSignal;
}

export class BadgeProtocolError extends Error {
	constructor(message: string, readonly causeResponse?: BadgeResponse) {
		super(message);
		this.name = 'BadgeProtocolError';
	}
}

const encoder = new TextEncoder();
const DEFAULT_TIMEOUT_MS = 4_000;
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_RETRY_DELAY_MS = 500;
const UPLOAD_FLUSH_LINES = 3;
const UPLOAD_FLUSH_TIMEOUT_MS = 1_000;

/** A single-owner, transport-neutral line protocol session. */
export class BadgeSession {
	private readonly parser = new LineParser();
	private pendingLines: string[] = [];
	private transactionTail: Promise<void> = Promise.resolve();

	constructor(
		private readonly transport: BadgeTransport,
		private readonly onLine?: (line: string) => void
	) {}

	async clearImage(options: TransactionOptions = {}): Promise<TransactionResult> {
		return this.transact('image clear', ['clear'], options);
	}

	async sendImageChunk(index: number, data: Uint8Array, options: TransactionOptions = {}): Promise<TransactionResult> {
		return this.transact(imageChunkCommand(index, data), ['ok', 'success'], options);
	}

	async uploadImage(image: Uint8Array, options: UploadOptions = {}): Promise<void> {
		if (image.byteLength !== IMAGE_BYTES) {
			throw new RangeError(`An image upload requires exactly ${IMAGE_BYTES} bytes.`);
		}
		return this.enqueue(async () => {
			await this.flushConsole(options.signal);
			for (let index = 0; index < IMAGE_CHUNK_COUNT; index += 1) {
				const start = index * 64;
				const result = await this.transactUnlocked(imageChunkCommand(index, image.subarray(start, start + 64)), ['ok', 'success'], options);
				if (result.response.kind === 'success' && index !== IMAGE_CHUNK_COUNT - 1) {
					throw new BadgeProtocolError('Badge completed the image before all chunks were sent.', result.response);
				}
				if (index === IMAGE_CHUNK_COUNT - 1 && result.response.kind !== 'success') {
					throw new BadgeProtocolError('Badge did not confirm image completion.', result.response);
				}
				options.onProgress?.(index + 1, IMAGE_CHUNK_COUNT);
				if (index < IMAGE_CHUNK_COUNT - 1) await delay(options.chunkDelayMs ?? 200, options.signal);
			}
		});
	}

	async executeConsoleCommand(command: string, options: ConsoleCommandOptions = {}): Promise<string[]> {
		if (!command.trim()) throw new RangeError('Enter a command.');
		if (/[\r\n]/.test(command)) throw new RangeError('Console commands must fit on one line.');
		const timeoutMs = options.timeoutMs ?? 10_000;
		const idleMs = options.idleMs ?? 750;
		if (timeoutMs <= 0 || idleMs <= 0) throw new RangeError('Console timeouts must be positive.');

		return this.enqueue(async () => {
			await this.writeCommand(command, options.signal);
			const lines: string[] = [];
			const totalTimeout = new AbortController();
			const totalTimeoutId = setTimeout(() => totalTimeout.abort(), timeoutMs);
			try {
				while (true) {
					const idleTimeout = new AbortController();
					const idleTimeoutId = setTimeout(() => idleTimeout.abort(), lines.length ? idleMs : timeoutMs);
					try {
						const signal = combineSignals(combineSignals(options.signal, totalTimeout.signal), idleTimeout.signal);
						const line = await this.nextLine(signal);
						if (line === null) throw new BadgeProtocolError('Transport closed while waiting for console output.');
						this.onLine?.(line);
						lines.push(line);
					} catch (error) {
						if (idleTimeout.signal.aborted && lines.length && !totalTimeout.signal.aborted) return lines;
						if (totalTimeout.signal.aborted && !options.signal?.aborted) {
							throw new BadgeProtocolError('Timed out waiting for console output.');
						}
						throw error;
					} finally {
						clearTimeout(idleTimeoutId);
					}
				}
			} finally {
				clearTimeout(totalTimeoutId);
			}
		});
	}

	async transact(
		command: string,
		expected: readonly BadgeResponseKind[],
		options: TransactionOptions = {}
	): Promise<TransactionResult> {
		return this.enqueue(() => this.transactUnlocked(command, expected, options));
	}

	private async transactUnlocked(
		command: string,
		expected: readonly BadgeResponseKind[],
		options: TransactionOptions
	): Promise<TransactionResult> {
		const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
		const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
		if (timeoutMs <= 0 || maxRetries < 0 || retryDelayMs < 0) throw new RangeError('Transaction timings must be non-negative.');

		for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
			throwIfAborted(options.signal);
			await this.writeCommand(command, options.signal);
			try {
				const response = await this.waitForResponse(expected, timeoutMs, options.signal, options.completeOn);
				return { response, attempt };
			} catch (error) {
				if (isAbortError(error) || attempt === maxRetries) throw error;
				await delay(retryDelayMs, options.signal);
			}
		}
		throw new BadgeProtocolError('Transaction exhausted without a response.');
	}

	private async writeCommand(command: string, signal?: AbortSignal): Promise<void> {
		const bytes = encoder.encode(`${command}\n`);
		const maxBytes = this.transport.writePacing?.maxBytes ?? bytes.byteLength;
		const delayMs = this.transport.writePacing?.delayMs ?? 0;
		for (let offset = 0; offset < bytes.byteLength; offset += maxBytes) {
			await this.transport.write(bytes.subarray(offset, offset + maxBytes), signal);
			if (offset + maxBytes < bytes.byteLength) {
				await delay(delayMs, signal);
			}
		}
	}

	/** Match dc34-image's startup synchronization before beginning an upload. */
	private async flushConsole(signal?: AbortSignal): Promise<void> {
		this.pendingLines = [];
		this.parser.reset();
		for (let index = 0; index < UPLOAD_FLUSH_LINES; index += 1) {
			await this.transport.write(encoder.encode('\r\n'), signal);
			const timeout = new AbortController();
			const timeoutId = setTimeout(() => timeout.abort(), UPLOAD_FLUSH_TIMEOUT_MS);
			try {
				await this.nextLine(combineSignals(signal, timeout.signal));
			} catch (error) {
				if (!timeout.signal.aborted || signal?.aborted) throw error;
			} finally {
				clearTimeout(timeoutId);
			}
		}
	}

	private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const previous = this.transactionTail;
		let release!: () => void;
		this.transactionTail = new Promise<void>((resolve) => (release = resolve));
		await previous;
		try {
			return await operation();
		} finally {
			release();
		}
	}

	private async waitForResponse(
		expected: readonly BadgeResponseKind[],
		timeoutMs: number,
		signal?: AbortSignal,
		completeOn?: BadgeResponseKind
	): Promise<BadgeResponse> {
		const timeout = new AbortController();
		const timeoutId = setTimeout(() => timeout.abort(), timeoutMs);
		const combined = combineSignals(signal, timeout.signal);
		try {
			while (true) {
				const line = await this.nextLine(combined);
				if (line === null) throw new BadgeProtocolError('Transport closed while waiting for a badge response.');
				const response = classifyResponse(line);
				this.onLine?.(line);
				if (response.kind === 'echo') continue;
				if (response.kind === 'unrelated' && !expected.includes('unrelated')) continue;
				if (expected.includes(response.kind)) {
					if (!completeOn || response.kind === completeOn) return response;
					continue;
				}
				if (response.kind === 'error') throw new BadgeProtocolError('Badge rejected the command.', response);
				throw new BadgeProtocolError(`Unexpected badge response: ${response.line}`, response);
			}
		} catch (error) {
			if (timeout.signal.aborted && !signal?.aborted) throw new BadgeProtocolError('Timed out waiting for a badge response.');
			throw error;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	private async nextLine(signal?: AbortSignal): Promise<string | null> {
		while (this.pendingLines.length === 0) {
			const bytes = await this.transport.read(signal);
			if (bytes === null) return null;
			this.pendingLines.push(...this.parser.push(bytes));
		}
		return this.pendingLines.shift() ?? null;
	}
}

function combineSignals(first?: AbortSignal, second?: AbortSignal): AbortSignal | undefined {
	if (!first) return second;
	if (!second) return first;
	return AbortSignal.any([first, second]);
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
	if (milliseconds === 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const finish = () => {
			if (signal) signal.removeEventListener('abort', abort);
			resolve();
		};
		const id = setTimeout(finish, milliseconds);
		if (!signal) return;
		function abort() {
			clearTimeout(id);
			signal?.removeEventListener('abort', abort);
			reject(new DOMException('The operation was aborted.', 'AbortError'));
		}
		if (signal.aborted) abort();
		else signal.addEventListener('abort', abort, { once: true });
	});
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}
