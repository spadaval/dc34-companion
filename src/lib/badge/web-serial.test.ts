import { afterEach, describe, expect, it, vi } from 'vitest';

import { browserSerialMode, WebSerialTransport } from './web-serial';

const polyfillState = vi.hoisted(() => ({ devices: [] as unknown[] }));

vi.mock('web-serial-polyfill', () => ({
	SerialPort: class {
		readonly readable = null;
		readonly writable = null;
		constructor(device: unknown) {
			polyfillState.devices.push(device);
		}
		async open(): Promise<void> {}
		async close(): Promise<void> {}
	}
}));

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

afterEach(() => {
	polyfillState.devices = [];
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

	it('filters the device picker only by the Baochip vendor ID', async () => {
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
			filters: [{ usbVendorId: 0x1d50 }]
		});
		await transport.close();
	});

	it('requests the Android WebUSB device by vendor without product or interface filters', async () => {
		const device = { productName: 'Baosec-lite' };
		const requestDevice = vi.fn(async () => device);
		Object.defineProperty(globalThis, 'navigator', {
			configurable: true,
			value: { usb: { requestDevice } }
		});

		const transport = new WebSerialTransport();
		await transport.connect();

		expect(requestDevice).toHaveBeenCalledWith({
			filters: [{ vendorId: 0x1d50 }]
		});
		expect(polyfillState.devices).toEqual([device]);
		await transport.close();
	});
});
