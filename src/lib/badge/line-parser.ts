/** Splits UTF-8 serial byte chunks into newline-delimited protocol lines. */
export class LineParser {
	private readonly decoder = new TextDecoder();
	private buffered = '';

	push(bytes: Uint8Array): string[] {
		this.buffered += this.decoder.decode(bytes, { stream: true });
		return this.takeLines();
	}

	finish(): string[] {
		this.buffered += this.decoder.decode();
		const lines = this.takeLines();
		if (this.buffered.length > 0) {
			lines.push(this.buffered.endsWith('\r') ? this.buffered.slice(0, -1) : this.buffered);
			this.buffered = '';
		}
		return lines;
	}

	reset(): void {
		this.decoder.decode();
		this.buffered = '';
	}

	private takeLines(): string[] {
		const lines: string[] = [];
		let newlineIndex: number;
		while ((newlineIndex = this.buffered.indexOf('\n')) !== -1) {
			let line = this.buffered.slice(0, newlineIndex);
			if (line.endsWith('\r')) line = line.slice(0, -1);
			lines.push(line);
			this.buffered = this.buffered.slice(newlineIndex + 1);
		}
		return lines;
	}
}
