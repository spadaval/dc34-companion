import { describe, expect, it } from 'vitest';

import {
	classifyResponse,
	crc32,
	createImageChunk,
	imageChunkCommand,
	IMAGE_CHUNK_WIRE_BYTES
} from './protocol';

describe('badge protocol primitives', () => {
	it('uses the stock CRC-32/ISO-HDLC implementation', () => {
		expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
	});

	it('frames an image chunk as big-endian index, 64 data bytes, and big-endian CRC', () => {
		const data = Uint8Array.from({ length: 64 }, (_, index) => index);
		const chunk = createImageChunk(0x1f, data);
		expect(chunk).toHaveLength(IMAGE_CHUNK_WIRE_BYTES);
		expect([...chunk.subarray(0, 2)]).toEqual([0, 31]);
		expect([...chunk.subarray(2, 66)]).toEqual([...data]);
		expect(new DataView(chunk.buffer).getUint32(66, false)).toBe(crc32(chunk.subarray(0, 66)));
		expect(imageChunkCommand(0, data)).toMatch(/^image [A-Za-z0-9+/]+=*$/);
	});

	it('classifies device replies and ignores console echoes and logs', () => {
		expect(classifyResponse(' OK\r')).toMatchObject({ kind: 'ok' });
		expect(classifyResponse('SUCCESS')).toMatchObject({ kind: 'success' });
		expect(classifyResponse('CLEAR')).toMatchObject({ kind: 'clear' });
		expect(classifyResponse('ERR')).toMatchObject({ kind: 'error' });
		expect(classifyResponse('[console] image clear')).toMatchObject({ kind: 'echo' });
		expect(classifyResponse('Xous version: v0.9.16-42-g123')).toMatchObject({ kind: 'version' });
		expect(classifyResponse('_|TT|_HW.PASS,_|TE|_')).toMatchObject({ kind: 'hardware-pass' });
		expect(classifyResponse('_|TT|_HW.FAIL,_|TE|_')).toMatchObject({ kind: 'hardware-fail' });
		expect(classifyResponse('temperature: 42')).toMatchObject({ kind: 'unrelated' });
	});
});
