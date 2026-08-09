---
strategy: dc34-companion
mission: build-browser-companion
revision: 8
status: active
sources:
  - README.md
  - https://github.com/bunnie/dc34-console
  - https://github.com/bunnie/dc34-image
---

# Outcome

Attendees can connect a DC34 badge from a supported browser, inspect a small set of safe diagnostics, interactively crop and convert an image into the badge's 128×128 one-bit format, preview the exact result, and upload or clear it with visible progress and recoverable errors.

# Target System

- A responsive SvelteKit application delivered over HTTPS by Vercel.
- A compact tabbed application shell with persistent connection status and an explicit connection modal.
- A transport-neutral badge client with explicit selection between each browser-supported transport: native Web Serial and WebUSB CDC-ACM.
- A lightweight in-process transport double used only for fast UI tests.
- A hosted-Xous validation harness that executes the actual DC34 console, image receiver, and hosted PDDB implementations. Running the actual DC34 vault remains a separate validation milestone.
- A single-owner, line-oriented serial session that tolerates command echo and unrelated log output.
- Browser-local image sourcing and processing: a built-in default, local files, CORS-permitted HTTP image URLs, explicit source removal, interactive square crop, zoom, threshold or Floyd–Steinberg dithering, exact wire-format preview, and chunked upload.
- A diagnostics surface plus an explicitly labeled raw console for user-directed badge commands.

# Governing Decisions

- SvelteKit remains the application framework; no React dependency is needed.
- Hardware access and image processing remain client-side. No badge data is uploaded to an application server.
- The protocol layer owns framing, timeouts, retries, response classification, and cancellation; UI components do not write raw serial data.
- Image uploads begin by clearing badge-side partial image state, then send 32 indexed CRC-protected chunks sequentially.
- Every console command clears pending shared-keyboard input before transmission so physical badge events cannot contaminate serial commands.
- Validation fidelity comes from running the pinned Rust implementations; protocol doubles are not evidence of firmware compatibility.
- Accessibility and understandable failure recovery take priority over dense expert tooling.

# Boundaries

- Browser support targets native Web Serial on desktop and selectable native Web Serial or WebUSB CDC-ACM in Chrome on USB-host-capable Android devices. Unsupported browsers receive actionable guidance.
- Hosted validation does not claim to emulate the Baochip CPU, secure boot, physical USB controller, flash timing, or every peripheral.
- This mission does not ship a native Android application, dedicated BIO/firmware/`k0` workflows, or arbitrary factory/test command buttons. Expert users may still invoke firmware-provided commands through the raw console.
- Diagnostics depend on what the stock badge prints; unavailable values remain clearly labeled rather than inferred.
- Real-device success must not be claimed without testing on physical hardware.

# Adaptation


## Must Preserve

- No server-side image transfer or telemetry.
- No silent device access; connection always follows the browser permission gesture.
- Destructive badge operations are never presented as first-class controls; the raw console carries an explicit mutation warning.
- Exact compatibility with the stock image chunk format.

## Managers May Change

- Component boundaries, styling, retry timing, diagnostic presentation, and browser-local state structure.
- The exact crop interaction implementation, provided touch, pointer, and keyboard users can produce the same output.

## Return To Strategy When

- The stock badge cannot sustain Web Serial transfers at the required settings.
- Android WebUSB cannot claim or reliably transfer through the badge's CDC-ACM interfaces.
- Reliable diagnostics require firmware changes or commands that mutate device state.

# Assurance

- Type and Svelte checks pass without warnings.
- Production build succeeds.
- Unit tests prove CRC, packing, chunk framing, line parsing, and image-processing determinism.
- Browser tests prove responsive navigation, unsupported-browser guidance, crop controls, conversion, and upload UI state using a fake transport.
- Fast browser tests may use a protocol double, but compatibility claims require the hosted Rust harness.
- Hosted tests prove real command parsing and response ordering plus byte-for-byte image persistence through the actual DC34 image receiver and hosted PDDB. They do not yet prove the DC34 vault's image-reload behavior.
- Physical-badge verification remains an explicit follow-up gate.

# Revision History

- Revision 1: Published for the user-directed full application build. Establishes web-first scope and excludes destructive/factory operations from the normal UI.
- Revision 2: User-directed expansion adds a simple browser-local virtual badge for hardware-free use; full hosted-Xous integration remains a later option.
- Revision 3: User-directed replacement removes the simulator as a product feature and makes hosted execution of the actual DC34 Rust/Xous stack the compatibility-validation target.
- Revision 4: User-directed UX rework replaces the landing-page layout with persistent status, task tabs, and a connection modal while retaining the existing workflows.
- Revision 5: User-directed expansion adds a raw interactive console, full diagnostic refresh, pre-command input clearing, and live image-transfer output.
- Revision 6: User-directed expansion adds an Android WebUSB CDC-ACM fallback while retaining native Web Serial on desktop. Physical Android-to-badge transfer remains the compatibility gate.
- Revision 7: User-directed image workflow expansion adds an upload-ready default, explicit editor-source removal, URL loading through browser CORS, and distinct labeling for badge-side clearing.
- Revision 8: User-directed transport control exposes every browser-supported connection path in the modal so Android users can choose WebUSB CDC when native Web Serial enumeration fails.
