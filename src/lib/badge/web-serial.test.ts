import { afterEach, describe, expect, it, vi } from 'vitest';

import { browserSerialMode, WebSerialTransport } from './web-serial';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

afterEach(() => {
	if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
	else Reflect.deleteProperty(globalThis, 'navigator');
});

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

	it('filters the device picker to the BaoSec badge USB identity', async () => {
		const port = {
			readable: null,
			writable: null,
			open: vi.fn(async () => undefined),
			close: vi.fn(async () => undefined)
		} as unknown as SerialPort;
		const requestPort = vi.fn(async () => port);
		Object.defineProperty(globalThis, 'navigator', {
			configurable: true,
			value: { serial: { requestPort, getPorts: async () => [] } }
		});

		const transport = new WebSerialTransport();
		await transport.connect();

		expect(requestPort).toHaveBeenCalledWith({
			filters: [{ usbVendorId: 0x1d50, usbProductId: 0x6198 }]
		});
		await transport.close();
	});
});
