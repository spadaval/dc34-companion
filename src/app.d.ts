declare global {
  interface SerialPort {
    readonly readable: ReadableStream<Uint8Array> | null;
    readonly writable: WritableStream<Uint8Array> | null;
    open(options: {
      baudRate: number;
      dataBits?: number;
      stopBits?: number;
      parity?: 'none' | 'even' | 'odd';
      flowControl?: 'none' | 'hardware';
      bufferSize?: number;
    }): Promise<void>;
    close(): Promise<void>;
  }

  interface Serial {
    requestPort(options?: { filters?: Array<{ usbVendorId?: number; usbProductId?: number }> }): Promise<SerialPort>;
    getPorts(): Promise<SerialPort[]>;
  }

  interface Navigator {
    readonly serial?: Serial;
    readonly usb?: unknown;
  }
}

export {};
