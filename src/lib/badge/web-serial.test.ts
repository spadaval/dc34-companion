import { describe, expect, it } from 'vitest';

import { browserSerialMode } from './web-serial';

describe('browserSerialMode', () => {
	it('prefers native Web Serial when both APIs exist', () => {
		expect(browserSerialMode({ serial: {} as Serial, usb: {} })).toBe('web-serial');
	});

	it('falls back to WebUSB when Web Serial is absent', () => {
		expect(browserSerialMode({ usb: {} })).toBe('web-usb');
	});

	it('reports unsupported when neither API exists', () => {
		expect(browserSerialMode({})).toBeNull();
	});
});
