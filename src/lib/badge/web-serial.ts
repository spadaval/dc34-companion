import type { BadgeTransport } from './transport';

interface ReadWaiter {
  resolve: (value: Uint8Array | null) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  abort?: () => void;
}

export type BrowserSerialMode = 'web-serial' | 'web-usb';

interface BrowserSerialApis {
  serial?: Serial;
  usb?: unknown;
}

interface WebUsbDeviceApi {
  requestDevice(options: { filters: Array<{ vendorId: number; productId: number }> }): Promise<unknown>;
}

export function browserSerialMode(apis: BrowserSerialApis): BrowserSerialMode | null {
  if (apis.serial) return 'web-serial';
  if (apis.usb) return 'web-usb';
  return null;
}

function modeLabel(mode: BrowserSerialMode | null): string {
  return mode === 'web-serial' ? 'Web Serial' : mode === 'web-usb' ? 'WebUSB · CDC' : 'Unavailable';
}

export class WebSerialTransport implements BadgeTransport {
  #mode: BrowserSerialMode | null = null;
  #port: SerialPort | null = null;
  #reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  #readTask: Promise<void> | null = null;
  #queue: Uint8Array[] = [];
  #waiters: ReadWaiter[] = [];

  constructor(private readonly onDisconnect?: () => void) {}

  static supported(): boolean {
    return typeof navigator !== 'undefined' && browserSerialMode(navigator) !== null;
  }

  static availableName(): string {
    return typeof navigator === 'undefined' ? 'Unavailable' : modeLabel(browserSerialMode(navigator));
  }

  get name(): string {
    return modeLabel(this.#mode);
  }

  get connected(): boolean {
    return this.#port !== null;
  }

  async connect(): Promise<void> {
    if (this.#port) return;

    this.#mode = browserSerialMode(navigator);
    if (!this.#mode) throw new Error('This browser does not provide Web Serial or WebUSB.');
    let port: SerialPort;
    if (this.#mode === 'web-serial') {
      if (!navigator.serial) throw new Error('Could not initialize Web Serial.');
      port = await navigator.serial.requestPort({
        filters: [{ usbVendorId: 0x1d50, usbProductId: 0x6198 }]
      });
    } else {
      const usb = navigator.usb as WebUsbDeviceApi;
      const device = await usb.requestDevice({
        // Deliberately omit classCode: Android may not match the CDC interface
        // nested behind the badge's composite FIDO + keyboard descriptors.
        filters: [{ vendorId: 0x1d50, productId: 0x6198 }]
      });
      const { SerialPort: WebUsbSerialPort } = await import('web-serial-polyfill');
      port = new WebUsbSerialPort(device as never) as unknown as SerialPort;
    }
    await port.open({ baudRate: 1_000_000, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    this.#port = port;
    this.#readTask = this.#readLoop(port);
  }

  async close(): Promise<void> {
    const port = this.#port;
    this.#port = null;
    await this.#reader?.cancel().catch(() => undefined);
    await this.#readTask?.catch(() => undefined);
    this.#readTask = null;
    this.#reader = null;
    this.#queue = [];
    this.#flushWaiters(null);
    await port?.close().catch(() => undefined);
  }

  async write(bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const writer = this.#port?.writable?.getWriter();
    if (!writer) throw new Error('Badge is not connected.');
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  }

  async read(signal?: AbortSignal): Promise<Uint8Array | null> {
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const queued = this.#queue.shift();
    if (queued) return queued;
    if (!this.#port) return null;

    return new Promise<Uint8Array | null>((resolve, reject) => {
      const waiter: ReadWaiter = { resolve, reject, signal };
      if (signal) {
        waiter.abort = () => {
          this.#waiters = this.#waiters.filter((candidate) => candidate !== waiter);
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        };
        signal.addEventListener('abort', waiter.abort, { once: true });
      }
      this.#waiters.push(waiter);
    });
  }

  async #readLoop(port: SerialPort): Promise<void> {
    if (!port.readable) return;
    const reader = port.readable.getReader();
    this.#reader = reader;
    try {
      while (this.#port === port) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) this.#deliver(value);
      }
    } catch (error) {
      if (this.#port === port) this.#rejectWaiters(error);
    } finally {
      reader.releaseLock();
      if (this.#reader === reader) this.#reader = null;
      if (this.#port === port) {
        this.#port = null;
        this.#flushWaiters(null);
        this.onDisconnect?.();
      }
    }
  }

  #deliver(bytes: Uint8Array): void {
    const waiter = this.#waiters.shift();
    if (!waiter) {
      this.#queue.push(bytes);
      return;
    }
    this.#detach(waiter);
    waiter.resolve(bytes);
  }

  #flushWaiters(value: null): void {
    for (const waiter of this.#waiters.splice(0)) {
      this.#detach(waiter);
      waiter.resolve(value);
    }
  }

  #rejectWaiters(error: unknown): void {
    for (const waiter of this.#waiters.splice(0)) {
      this.#detach(waiter);
      waiter.reject(error);
    }
  }

  #detach(waiter: ReadWaiter): void {
    if (waiter.signal && waiter.abort) waiter.signal.removeEventListener('abort', waiter.abort);
  }
}
