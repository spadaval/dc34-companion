import { describe, expect, it } from 'vitest';

import { LineParser } from './line-parser';

describe('LineParser', () => {
	it('splits lines across every arbitrary byte boundary', () => {
		const encoded = new TextEncoder().encode('[console] image x\r\nOK\nlog: café\n');
		for (let split = 1; split < encoded.length; split += 1) {
			const parser = new LineParser();
			expect([...parser.push(encoded.subarray(0, split)), ...parser.push(encoded.subarray(split))]).toEqual([
				'[console] image x',
				'OK',
				'log: café'
			]);
		}
	});

	it('emits a final unterminated line only when finished', () => {
		const parser = new LineParser();
		expect(parser.push(new TextEncoder().encode('OK'))).toEqual([]);
		expect(parser.finish()).toEqual(['OK']);
	});
});
