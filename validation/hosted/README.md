# Hosted DC34 image-path validation

This fixture runs the pinned, real `dc34-console` image command under pinned hosted Xous. It sends the same 32 indexed, CRC-protected, base64 chunks used by the serial protocol and checks the handler's exact responses and PDDB readback.

Run it on Linux with Rust, Cargo, Git, and standard GNU process tools available:

```sh
./run-hosted.sh
```

The first run clones and builds dependencies below `.cache/`. To clone from existing local repositories without modifying them:

```sh
XOUS_CORE_SOURCE=/path/to/xous-core \
DC34_CONSOLE_SOURCE=/path/to/dc34-console \
DC34_API_SOURCE=/path/to/dc34-api \
./run-hosted.sh
```

Set `DC34_HOSTED_CACHE_DIR`, `DC34_HOSTED_LOG`, or `DC34_HOSTED_TIMEOUT_SECONDS` to override their defaults. Remove `.cache/` to force a completely fresh checkout and build.

## What it validates

- The pinned `dc34-console` command parser runs as a real Xous process.
- `image clear` returns exactly one `CLEAR`.
- All 32 exact wire-format chunks pass index and CRC checks: 31 `OK` replies and one final `SUCCESS`.
- The completed image is written through the real PDDB API and reads back as exactly:
  `VERIFY len=2048 crc32=21a990cd first=[03, 02, 01, 00, 07, 06, 05, 04] last=[fb, fa, f9, f8, ff, fe, fd, fc]`.

The small console overlay only gates hardware-only startup paths in hosted mode, mounts PDDB for the headless test, and adds the hosted-only `image verify` readback command. The Xous patch adds deterministic stdin injection, substitutes the external DC34 console for the stock console, and allows headless hosted PDDB initialization.

## What it does not validate

- The real `dc34-vault` is not part of this run and remains unproven under hosted Xous. The feasibility spike reached a mixed-generation `keystore-api` build failure; stock Xous `vault2` is not evidence for DC34 vault behavior.
- Hardware-only power, BIO, LEDs, watchdog, USB transport, display, and reload rendering are not validated.
- The original manifest pin `616bf65f6e379165464f50b1e79ec42aff77a683` is not silently treated as working: it cannot resolve `keystore/owc-inc`. The exercised compatibility pin is recorded in `pins.env`.
