# DC34 Companion

A local-first browser companion for the DEF CON 34 badge. It connects directly over Web Serial, shows basic diagnostics, and turns ordinary images into the badge's exact 128×128, one-bit upload format.

## Features

- Explicit, user-approved serial connection at 1,000,000 baud
- Firmware version, hardware diagnostics, and manual refresh controls
- Interactive serial console for direct badge commands
- Interactive square crop, zoom, positioning, threshold, and Floyd–Steinberg dithering
- Exact pixel preview and protocol-compatible 2,048-byte image upload
- Per-chunk validation, retry, live console transcript, and clear-image controls
- Responsive layout for desktop and mobile-sized browsers

Images and serial data stay in the browser; the app has no upload service or analytics. Firmware flashing, key management, and factory operations are not exposed as first-class workflows. The raw console is intended for expert use and warns that commands may change stored data.

## Browser support

Web Serial requires a secure context and is best supported by current Chromium browsers such as Chrome or Edge on desktop. Android support varies by browser and USB hardware. Safari and Firefox do not currently expose Web Serial.

## Development

```sh
npm install
npm run dev
```

Before shipping a change:

```sh
npm test
npm run check
npm run build
npm run test:e2e
```

The fast browser tests use a protocol test double. The hosted validation harness runs the real DC34 console image handler and hosted PDDB under Xous:

```sh
./validation/hosted/run-hosted.sh
```

See [validation/hosted/README.md](validation/hosted/README.md) for prerequisites and the exact validation boundary. Physical USB behavior and the DC34 vault still require separate validation.
