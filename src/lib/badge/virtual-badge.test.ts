import { describe, expect, it } from 'vitest';

import { IMAGE_BYTES, base64Encode, createImageChunk, crc32 } from './protocol';
import { VirtualBadgeTransport } from './virtual-badge';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

async function command(transport: VirtualBadgeTransport, text: string): Promise<string> {
	await transport.write(encoder.encode(`${text}\n`));
	const reply = await transport.read();
	if (reply === null) throw new Error('Virtual badge closed unexpectedly.');
	return decoder.decode(reply);
}

describe('VirtualBadgeTransport', () => {
	it('reports the Xous version after its console echo', async () => {
		const transport = new VirtualBadgeTransport();
		await transport.connect();

		expect(await command(transport, 'ver xous')).toBe('[console] ver xous\nXous version: virtual-badge-1.0\n');
		expect(transport.state).toMatchObject({ connected: true, firmwareVersion: 'virtual-badge-1.0', storedImage: null });
	});

	it('emits the hardware result before its final version line', async () => {
		const transport = new VirtualBadgeTransport();
		await transport.connect();

		expect(await command(transport, 'test hw')).toBe(
			'[console] test hw\n_|TT|_HW.PASS,_|TE|_\nXous version: virtual-badge-1.0\n'
		);
	});

	it('clears the persisted display image and its received chunk markers', async () => {
		const transport = new VirtualBadgeTransport();
		await transport.connect();
		await command(transport, `image ${base64Encode(createImageChunk(0, new Uint8Array(64).fill(0xff)))}`);

		expect(await command(transport, 'image clear')).toBe('[console] image clear\nCLEAR\n');
		expect(transport.state.receivedChunks).toEqual([]);
		expect(transport.state.storedImage).toBeNull();
	});

	it('reconstructs a complete image from all 32 stock chunks', async () => {
		const transport = new VirtualBadgeTransport();
		await transport.connect();
		const image = Uint8Array.from({ length: IMAGE_BYTES }, (_, index) => index & 0xff);
		await command(transport, 'image clear');

		for (let index = 0; index < 32; index += 1) {
			const reply = await command(transport, `image ${base64Encode(createImageChunk(index, image.subarray(index * 64, index * 64 + 64)))}`);
			expect(reply).toBe(`[console] image ${base64Encode(createImageChunk(index, image.subarray(index * 64, index * 64 + 64)))}\n${index === 31 ? 'SUCCESS' : 'OK'}\n`);
			if (index === 0) expect(transport.state.storedImage).toBeNull();
		}

		expect(transport.state.receivedChunks).toEqual([...Array(32).keys()]);
		expect(transport.state.storedImage).toEqual(image);

		await transport.close();
		await transport.connect();
		expect(transport.state.storedImage).toEqual(image);
		expect(await command(transport, 'image clear')).toBe('[console] image clear\nCLEAR\n');
		expect(transport.state.storedImage).toBeNull();
	});

	it('rejects a chunk with an invalid CRC without mutating the display image', async () => {
		const transport = new VirtualBadgeTransport();
		await transport.connect();
		await command(transport, 'image clear');
		const invalid = createImageChunk(0, new Uint8Array(64).fill(0xaa));
		invalid[69] ^= 1;

		expect(await command(transport, `image ${base64Encode(invalid)}`)).toBe(
			`[console] image ${base64Encode(invalid)}\nERR\n`
		);
		expect(transport.state.receivedChunks).toEqual([]);
		expect(transport.state.storedImage).toBeNull();
	});

	it('rejects malformed base64 framing and out-of-range chunk indices', async () => {
		const transport = new VirtualBadgeTransport();
		await transport.connect();
		await command(transport, 'image clear');
		const outOfRange = new Uint8Array(createImageChunk(0, new Uint8Array(64)));
		new DataView(outOfRange.buffer).setUint16(0, 32, false);
		new DataView(outOfRange.buffer).setUint32(66, 0, false);
		new DataView(outOfRange.buffer).setUint32(66, crc32(outOfRange.subarray(0, 66)), false);

		expect(await command(transport, 'image not-base64!')).toContain('\nERR\n');
		expect(await command(transport, `image ${base64Encode(outOfRange)}`)).toContain('\nERR\n');
		expect(transport.state.receivedChunks).toEqual([]);
	});
});
