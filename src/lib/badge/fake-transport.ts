import type { BadgeTransport } from './transport';

/** Deterministic in-memory transport for protocol and UI tests. */
export class FakeBadgeTransport implements BadgeTransport {
	readonly writes: Uint8Array[] = [];
	private readonly incoming: (Uint8Array | null)[] = [];
	private readonly readers: {
		resolve: (value: Uint8Array | null) => void;
		reject: (reason: unknown) => void;
		signal?: AbortSignal;
	}[] = [];

	constructor(readonly writePacing?: { maxBytes: number; delayMs: number }) {}

	async write(bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) throw abortError();
		this.writes.push(bytes.slice());
	}

	read(signal?: AbortSignal): Promise<Uint8Array | null> {
		if (signal?.aborted) return Promise.reject(abortError());
		const next = this.incoming.shift();
		if (next !== undefined) return Promise.resolve(next);
		return new Promise((resolve, reject) => {
			const reader = { resolve, reject, signal };
			this.readers.push(reader);
			if (signal) {
				signal.addEventListener(
					'abort',
					() => {
						const index = this.readers.indexOf(reader);
						if (index !== -1) this.readers.splice(index, 1);
						reject(abortError());
					},
					{ once: true }
				);
			}
		});
	}

	enqueue(...chunks: (Uint8Array | null)[]): void {
		for (const chunk of chunks) {
			const reader = this.readers.shift();
			if (reader) reader.resolve(chunk);
			else this.incoming.push(chunk);
		}
	}

	enqueueText(...lines: string[]): void {
		this.enqueue(...lines.map((line) => new TextEncoder().encode(line)));
	}

	async close(): Promise<void> {
		this.enqueue(null);
	}
}

function abortError(): DOMException {
	return new DOMException('The operation was aborted.', 'AbortError');
}
