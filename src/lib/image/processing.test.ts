import { describe, expect, it } from 'vitest';
import {
	BADGE_PAYLOAD_BYTES,
	BADGE_PIXEL_COUNT,
	BADGE_WIDTH,
	convertToBadgeImage,
	packBadgePixels,
	toMonochrome,
	unpackBadgePayload
} from './processing';

const source = (width: number, height: number, pixels: number[]) => ({ width, height, pixels: Uint8Array.from(pixels) });

describe('DC34 image processing', () => {
	it('creates a 128 × 128 preview and an exact 2,048-byte payload', () => {
		const result = convertToBadgeImage(source(1, 1, [255]), { x: 0, y: 0, size: 1 });
		expect(result.width).toBe(BADGE_WIDTH);
		expect(result.previewPixels).toHaveLength(BADGE_PIXEL_COUNT);
		expect(result.payload).toHaveLength(BADGE_PAYLOAD_BYTES);
	});

	it('packs all-white and all-black images as the reference format expects', () => {
		expect(packBadgePixels(new Uint8Array(BADGE_PIXEL_COUNT).fill(255))).toEqual(new Uint8Array(BADGE_PAYLOAD_BYTES));
		expect(packBadgePixels(new Uint8Array(BADGE_PIXEL_COUNT))).toEqual(new Uint8Array(BADGE_PAYLOAD_BYTES).fill(255));
	});

	it('uses threshold behavior with a black-below boundary', () => {
		const pixels = new Uint8Array(BADGE_PIXEL_COUNT).fill(128);
		pixels[0] = 127;
		expect(toMonochrome(pixels, { threshold: 128 }).slice(0, 2)).toEqual(Uint8Array.from([0, 255]));
	});

	it('resamples a crop deterministically', () => {
		const image = source(2, 1, [0, 255]);
		const crop = { x: 0, y: 0, size: 1 };
		const first = convertToBadgeImage(image, crop, { threshold: 128 });
		const second = convertToBadgeImage(image, crop, { threshold: 128 });
		expect(first.previewPixels).toEqual(second.previewPixels);
		expect(first.previewPixels[0]).toBe(0);
	});

	it('runs Floyd–Steinberg deterministically and produces only monochrome pixels', () => {
		const pixels = Uint8Array.from({ length: BADGE_PIXEL_COUNT }, (_, index) => (index * 37) % 256);
		const first = toMonochrome(pixels, { dither: 'floyd-steinberg', threshold: 128 });
		const second = toMonochrome(pixels, { dither: 'floyd-steinberg', threshold: 128 });
		expect(first).toEqual(second);
		expect([...first].every((pixel) => pixel === 0 || pixel === 255)).toBe(true);
	});

	it('matches reference flip, MSB-first, and four-word reversal ordering', () => {
		const pixels = new Uint8Array(BADGE_PIXEL_COUNT).fill(255);
		pixels[0] = 0; // Left-most preview pixel becomes bit 0 of wire word 3.
		pixels[127] = 0; // Right-most preview pixel becomes bit 31 of wire word 0.
		const payload = packBadgePixels(pixels);
		expect([...payload.slice(0, 16)]).toEqual([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0x80, 0, 0, 0]);
		expect(unpackBadgePayload(payload)).toEqual(pixels);
	});
});
