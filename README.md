# DC34 Companion

A local-first browser companion for the DEF CON 34 badge. It connects directly over Web Serial, shows basic diagnostics, and turns ordinary images into the badge's exact 128×128, one-bit upload format.

## Features

- Explicit, user-approved serial connection at 1,000,000 baud
- Firmware version and read-only hardware diagnostic console
- Interactive square crop, zoom, positioning, threshold, and Floyd–Steinberg dithering
- Exact pixel preview and protocol-compatible 2,048-byte image upload
- Per-chunk validation, retry, progress, and clear-image controls
- Responsive layout for desktop and mobile-sized browsers
- Browser-local virtual badge for trying the complete workflow without hardware

Images and serial data stay in the browser; the app has no upload service or analytics. The normal interface deliberately excludes firmware flashing, key management, factory commands, and other destructive console operations.

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

The browser tests use a simulated badge transport; final hardware compatibility still needs a physical DC34 badge.

## Virtual badge

Choose **Try virtual badge** to exercise firmware detection, diagnostics, image clearing, and a complete upload without USB hardware. The simulator validates the same chunk indexes and CRC-framed 2,048-byte payload used by the real badge, then renders the reconstructed display image in the connection panel. It models the companion-facing console protocol rather than the Baochip CPU or boot chain.
