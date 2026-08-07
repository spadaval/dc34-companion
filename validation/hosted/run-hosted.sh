#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/pins.env"

CACHE_DIR="${DC34_HOSTED_CACHE_DIR:-$SCRIPT_DIR/.cache}"
WORK_DIR="$CACHE_DIR/work"
XOUS_DIR="$WORK_DIR/xous-core"
CONSOLE_DIR="$XOUS_DIR/spike/dc34-console"
API_DIR="$WORK_DIR/dc34-api"
TARGET_DIR="$CACHE_DIR/target"
LOG_FILE="${DC34_HOSTED_LOG:-$SCRIPT_DIR/hosted-run.log}"
TIMEOUT_SECONDS="${DC34_HOSTED_TIMEOUT_SECONDS:-600}"
EXPECTED_VERIFY='VERIFY len=2048 crc32=21a990cd first=[03, 02, 01, 00, 07, 06, 05, 04] last=[fb, fa, f9, f8, ff, fe, fd, fc]'

XOUS_SOURCE="${XOUS_CORE_SOURCE:-$XOUS_CORE_URL}"
CONSOLE_SOURCE="${DC34_CONSOLE_SOURCE:-$DC34_CONSOLE_URL}"
API_SOURCE="${DC34_API_SOURCE:-$DC34_API_URL}"

for tool in cargo git grep sed setsid sleep; do
    command -v "$tool" >/dev/null 2>&1 || {
        echo "error: required tool '$tool' is unavailable" >&2
        exit 2
    }
done

case "$TIMEOUT_SECONDS" in
    ''|*[!0-9]*) echo "error: DC34_HOSTED_TIMEOUT_SECONDS must be a positive integer" >&2; exit 2 ;;
    0) echo "error: DC34_HOSTED_TIMEOUT_SECONDS must be greater than zero" >&2; exit 2 ;;
esac

mkdir -p "$WORK_DIR" "$TARGET_DIR"
export CARGO_HOME="${DC34_HOSTED_CARGO_HOME:-$CACHE_DIR/cargo}"
mkdir -p "$CARGO_HOME"

clone_pinned() {
    local source="$1"
    local revision="$2"
    local destination="$3"
    local label="$4"

    if [ ! -d "$destination/.git" ]; then
        if [ -e "$destination" ]; then
            echo "error: $destination exists but is not a Git checkout" >&2
            exit 2
        fi
        mkdir -p "$destination"
        git -C "$destination" init -q
        git -C "$destination" remote add origin "$source"
        git -C "$destination" fetch --depth=1 origin "$revision"
        git -C "$destination" checkout -q --detach FETCH_HEAD
    fi

    local actual
    actual="$(git -C "$destination" rev-parse HEAD)"
    if [ "$actual" != "$revision" ]; then
        echo "error: cached $label is at $actual, expected $revision" >&2
        echo "remove $CACHE_DIR to recreate the pinned checkout" >&2
        exit 2
    fi
}

apply_once() {
    local repository="$1"
    local patch_file="$2"
    if git -C "$repository" apply --check --ignore-space-change "$patch_file" 2>/dev/null; then
        git -C "$repository" apply --ignore-space-change "$patch_file"
    elif git -C "$repository" apply --reverse --check --ignore-space-change "$patch_file" 2>/dev/null; then
        : # Already applied in this cache.
    else
        echo "error: patch does not apply cleanly: $patch_file" >&2
        exit 2
    fi
}

echo "Preparing pinned Xous $XOUS_CORE_REV"
clone_pinned "$XOUS_SOURCE" "$XOUS_CORE_REV" "$XOUS_DIR" xous-core
clone_pinned "$API_SOURCE" "$DC34_API_REV" "$API_DIR" dc34-api
clone_pinned "$CONSOLE_SOURCE" "$DC34_CONSOLE_REV" "$CONSOLE_DIR" dc34-console

apply_once "$XOUS_DIR" "$SCRIPT_DIR/patches/xous-core-hosted.patch"
# The upstream image command is CRLF; normalize this one source before applying
# the reviewable line-oriented hosted overlay.
sed -i 's/\r$//' "$CONSOLE_DIR/src/cmds/image.rs"
apply_once "$CONSOLE_DIR" "$SCRIPT_DIR/overlay/dc34-console-hosted.patch"
mkdir -p "$CONSOLE_DIR/src/bin"
install -m 0644 "$SCRIPT_DIR/overlay/make_image_commands.rs" "$CONSOLE_DIR/src/bin/make_image_commands.rs"

echo "Building pinned dc34-console hosted overlay"
CARGO_TARGET_DIR="$TARGET_DIR/console" \
    cargo build --manifest-path "$CONSOLE_DIR/Cargo.toml" \
    --release --no-default-features --features hosted-baosec

CONSOLE_BIN="$TARGET_DIR/console/release/dc34-console"
GENERATOR_BIN="$TARGET_DIR/console/release/make_image_commands"
COMMANDS_FILE="$CACHE_DIR/image-commands.txt"
"$GENERATOR_BIN" > "$COMMANDS_FILE"

# Every run starts with a new hosted PDDB so mount, format, write, and readback
# are all exercised. This file is confined to the harness cache checkout.
rm -f "$XOUS_DIR/tools/pddb-images/hosted.bin"
: > "$LOG_FILE"

RUN_PID=''
stop_hosted() {
    if [ -n "$RUN_PID" ] && kill -0 "$RUN_PID" 2>/dev/null; then
        kill -TERM -- "-$RUN_PID" 2>/dev/null || true
        wait "$RUN_PID" 2>/dev/null || true
    fi
}
trap stop_hosted EXIT INT TERM

echo "Running hosted Xous; log: $LOG_FILE"
(
    cd "$XOUS_DIR"
    exec setsid env \
        XOUS_HOSTED_STDIN=1 \
        XOUS_HOSTED_STDIN_DELAY_MS=500 \
        XOUS_HOSTED_STDIN_BYTE_DELAY_MS=2 \
        cargo xtask baosec-emu "dc34-console:$CONSOLE_BIN" --no-timestamp \
        < "$COMMANDS_FILE" > "$LOG_FILE" 2>&1
) &
RUN_PID=$!

start_seconds=$SECONDS
while ! grep -Fqx "$EXPECTED_VERIFY" "$LOG_FILE"; do
    if ! kill -0 "$RUN_PID" 2>/dev/null; then
        wait "$RUN_PID" || true
        echo "error: hosted Xous exited before verification" >&2
        tail -n 80 "$LOG_FILE" >&2
        exit 1
    fi
    if (( SECONDS - start_seconds >= TIMEOUT_SECONDS )); then
        echo "error: timed out after $TIMEOUT_SECONDS seconds" >&2
        tail -n 80 "$LOG_FILE" >&2
        exit 1
    fi
    sleep 1
done

stop_hosted
RUN_PID=''
trap - EXIT INT TERM

assert_exact_count() {
    local line="$1"
    local expected="$2"
    local label="$3"
    local actual
    actual="$(grep -Fxc "$line" "$LOG_FILE" || true)"
    if [ "$actual" != "$expected" ]; then
        echo "error: expected $expected $label line(s), found $actual" >&2
        exit 1
    fi
}

assert_exact_count CLEAR 1 CLEAR
assert_exact_count OK 31 OK
assert_exact_count SUCCESS 1 SUCCESS
assert_exact_count "$EXPECTED_VERIFY" 1 VERIFY

echo "PASS: CLEAR=1 OK=31 SUCCESS=1"
echo "PASS: $EXPECTED_VERIFY"
