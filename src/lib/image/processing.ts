/** Deterministic, DOM-independent conversion for the DC34 128 × 128 display. */

export const BADGE_WIDTH = 128;
export const BADGE_HEIGHT = 128;
export const BADGE_PIXEL_COUNT = BADGE_WIDTH * BADGE_HEIGHT;
export const BADGE_PAYLOAD_BYTES = BADGE_PIXEL_COUNT / 8;

export type DitherMode = 'threshold' | 'floyd-steinberg';

/** One 0–255 luminance value per pixel, in row-major order. */
export interface GrayscaleImage {
	width: number;
	height: number;
	pixels: Uint8Array;
}

/** A square in source-pixel coordinates. Fractional values support UI zoom. */
export interface SquareCrop {
	x: number;
	y: number;
	size: number;
}

export interface ConversionOptions {
	/** Luminance below this value is black. Defaults to 128. */
	threshold?: number;
	dither?: DitherMode;
}

export interface BadgeImage {
	width: typeof BADGE_WIDTH;
	height: typeof BADGE_HEIGHT;
	/** Display-order grayscale values: black is 0 and white is 255. */
	previewPixels: Uint8Array;
	/** The exact 2,048-byte payload expected by send_image.py. */
	payload: Uint8Array;
}

function assertFinite(value: number, name: string): void {
	if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function validateImage(image: GrayscaleImage): void {
	if (!Number.isInteger(image.width) || image.width < 1) {
		throw new RangeError('image width must be a positive integer');
	}
	if (!Number.isInteger(image.height) || image.height < 1) {
		throw new RangeError('image height must be a positive integer');
	}
	if (image.pixels.length !== image.width * image.height) {
		throw new RangeError('image pixel count does not match its dimensions');
	}
}

function validateCrop(image: GrayscaleImage, crop: SquareCrop): void {
	assertFinite(crop.x, 'crop x');
	assertFinite(crop.y, 'crop y');
	assertFinite(crop.size, 'crop size');
	if (crop.size <= 0 || crop.x < 0 || crop.y < 0 || crop.x + crop.size > image.width || crop.y + crop.size > image.height) {
		throw new RangeError('crop must be a positive square contained within the image');
	}
}

/**
 * Samples a square crop to 128 × 128 using bilinear interpolation at pixel
 * centres. The method is deterministic and does not depend on Canvas.
 */
export function cropAndResample(image: GrayscaleImage, crop: SquareCrop): Uint8Array {
	validateImage(image);
	validateCrop(image, crop);

	const sampled = new Uint8Array(BADGE_PIXEL_COUNT);
	for (let targetY = 0; targetY < BADGE_HEIGHT; targetY += 1) {
		const sourceY = crop.y + ((targetY + 0.5) * crop.size) / BADGE_HEIGHT - 0.5;
		const y0 = Math.max(0, Math.floor(sourceY));
		const y1 = Math.min(image.height - 1, y0 + 1);
		const yWeight = Math.max(0, Math.min(1, sourceY - y0));

		for (let targetX = 0; targetX < BADGE_WIDTH; targetX += 1) {
			const sourceX = crop.x + ((targetX + 0.5) * crop.size) / BADGE_WIDTH - 0.5;
			const x0 = Math.max(0, Math.floor(sourceX));
			const x1 = Math.min(image.width - 1, x0 + 1);
			const xWeight = Math.max(0, Math.min(1, sourceX - x0));
			const top = image.pixels[y0 * image.width + x0] * (1 - xWeight) + image.pixels[y0 * image.width + x1] * xWeight;
			const bottom = image.pixels[y1 * image.width + x0] * (1 - xWeight) + image.pixels[y1 * image.width + x1] * xWeight;
			sampled[targetY * BADGE_WIDTH + targetX] = Math.round(top * (1 - yWeight) + bottom * yWeight);
		}
	}
	return sampled;
}

function validateThreshold(threshold: number): void {
	if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) {
		throw new RangeError('threshold must be between 0 and 255');
	}
}

/** Converts grayscale pixels to black (0) and white (255), in display order. */
export function toMonochrome(pixels: Uint8Array, options: ConversionOptions = {}): Uint8Array {
	if (pixels.length !== BADGE_PIXEL_COUNT) {
		throw new RangeError(`expected ${BADGE_PIXEL_COUNT} pixels`);
	}
	const threshold = options.threshold ?? 128;
	const dither = options.dither ?? 'threshold';
	validateThreshold(threshold);
	if (dither === 'threshold') {
		return Uint8Array.from(pixels, (pixel) => (pixel < threshold ? 0 : 255));
	}
	if (dither !== 'floyd-steinberg') throw new RangeError(`unsupported dither mode: ${dither}`);

	const work = Float64Array.from(pixels);
	const output = new Uint8Array(BADGE_PIXEL_COUNT);
	const diffuse = (x: number, y: number, error: number, weight: number): void => {
		if (x >= 0 && x < BADGE_WIDTH && y >= 0 && y < BADGE_HEIGHT) work[y * BADGE_WIDTH + x] += error * weight;
	};
	for (let y = 0; y < BADGE_HEIGHT; y += 1) {
		for (let x = 0; x < BADGE_WIDTH; x += 1) {
			const index = y * BADGE_WIDTH + x;
			const quantized = work[index] < threshold ? 0 : 255;
			output[index] = quantized;
			const error = work[index] - quantized;
			diffuse(x + 1, y, error, 7 / 16);
			diffuse(x - 1, y + 1, error, 3 / 16);
			diffuse(x, y + 1, error, 5 / 16);
			diffuse(x + 1, y + 1, error, 1 / 16);
		}
	}
	return output;
}

/**
 * Packs display-order monochrome pixels into the badge's wire order.
 * It exactly mirrors send_image.py: horizontal flip, black=1, MSB-first words,
 * then reverse every group of four 32-bit words and write them big-endian.
 */
export function packBadgePixels(previewPixels: Uint8Array): Uint8Array {
	if (previewPixels.length !== BADGE_PIXEL_COUNT) {
		throw new RangeError(`expected ${BADGE_PIXEL_COUNT} preview pixels`);
	}
	const words = new Uint32Array(BADGE_PIXEL_COUNT / 32);
	for (let y = 0; y < BADGE_HEIGHT; y += 1) {
		for (let x = 0; x < BADGE_WIDTH; x += 1) {
			if (previewPixels[y * BADGE_WIDTH + (BADGE_WIDTH - 1 - x)] === 0) {
				const bitIndex = y * BADGE_WIDTH + x;
				words[bitIndex >>> 5] |= 1 << (31 - (bitIndex & 31));
			}
		}
	}

	const payload = new Uint8Array(BADGE_PAYLOAD_BYTES);
	for (let group = 0; group < words.length; group += 4) {
		for (let position = 0; position < 4; position += 1) {
			const word = words[group + 3 - position];
			const offset = (group + position) * 4;
			payload[offset] = word >>> 24;
			payload[offset + 1] = word >>> 16;
			payload[offset + 2] = word >>> 8;
			payload[offset + 3] = word;
		}
	}
	return payload;
}

/** Inverse of packBadgePixels, useful for proving and rendering the exact wire result. */
export function unpackBadgePayload(payload: Uint8Array): Uint8Array {
	if (payload.length !== BADGE_PAYLOAD_BYTES) {
		throw new RangeError(`expected ${BADGE_PAYLOAD_BYTES} payload bytes`);
	}
	const previewPixels = new Uint8Array(BADGE_PIXEL_COUNT).fill(255);
	for (let group = 0; group < BADGE_PIXEL_COUNT / 32; group += 4) {
		for (let position = 0; position < 4; position += 1) {
			const offset = (group + position) * 4;
			const word = (payload[offset] * 0x1000000) + (payload[offset + 1] << 16) + (payload[offset + 2] << 8) + payload[offset + 3];
			const originalWord = group + 3 - position;
			for (let bit = 0; bit < 32; bit += 1) {
				if ((word & (1 << (31 - bit))) !== 0) {
					const packedIndex = originalWord * 32 + bit;
					const y = Math.floor(packedIndex / BADGE_WIDTH);
					const x = packedIndex % BADGE_WIDTH;
					previewPixels[y * BADGE_WIDTH + (BADGE_WIDTH - 1 - x)] = 0;
				}
			}
		}
	}
	return previewPixels;
}

export function convertToBadgeImage(image: GrayscaleImage, crop: SquareCrop, options: ConversionOptions = {}): BadgeImage {
	const previewPixels = toMonochrome(cropAndResample(image, crop), options);
	return { width: BADGE_WIDTH, height: BADGE_HEIGHT, previewPixels, payload: packBadgePixels(previewPixels) };
}
