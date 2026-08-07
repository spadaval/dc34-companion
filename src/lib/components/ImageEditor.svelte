<script lang="ts">
  import {
    convertToBadgeImage,
    type BadgeImage,
    type DitherMode,
    type GrayscaleImage,
    type SquareCrop
  } from '$lib/image/processing';

  let { onready }: { onready?: (image: BadgeImage | null) => void } = $props();

  let sourceCanvas: HTMLCanvasElement = $state()!;
  let outputCanvas: HTMLCanvasElement = $state()!;
  let source: GrayscaleImage | null = $state(null);
  let sourceBitmap: ImageBitmap | null = $state(null);
  let filename = $state('');
  let crop: SquareCrop = $state({ x: 0, y: 0, size: 1 });
  let zoom = $state(0);
  let threshold = $state(128);
  let dither: DitherMode = $state('floyd-steinberg');
  let error = $state('');
  let drag: { x: number; y: number; cropX: number; cropY: number } | null = null;
  let display = { scale: 1, offsetX: 0, offsetY: 0 };

  $effect(() => {
    source;
    sourceBitmap;
    crop.x;
    crop.y;
    crop.size;
    threshold;
    dither;
    if (!source || !sourceBitmap || !sourceCanvas || !outputCanvas) return;
    renderSource();
    try {
      const result = convertToBadgeImage(source, crop, { threshold, dither });
      renderOutput(result);
      onready?.(result);
      error = '';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not process this image.';
      onready?.(null);
    }
  });

  async function chooseFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Choose an image smaller than 20 MB.');
      sourceBitmap?.close();
      const bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 40_000_000) {
        bitmap.close();
        throw new Error('Choose an image smaller than 40 megapixels.');
      }
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas is unavailable in this browser.');
      context.drawImage(bitmap, 0, 0);
      const rgba = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const pixels = new Uint8Array(bitmap.width * bitmap.height);
      for (let index = 0; index < pixels.length; index += 1) {
        const offset = index * 4;
        const alpha = rgba[offset + 3] / 255;
        const luminance = rgba[offset] * 0.2126 + rgba[offset + 1] * 0.7152 + rgba[offset + 2] * 0.0722;
        pixels[index] = Math.round(luminance * alpha + 255 * (1 - alpha));
      }
      sourceBitmap = bitmap;
      source = { width: bitmap.width, height: bitmap.height, pixels };
      filename = file.name;
      zoom = 0;
      const size = Math.min(bitmap.width, bitmap.height);
      crop = { x: (bitmap.width - size) / 2, y: (bitmap.height - size) / 2, size };
      error = '';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not open this image.';
      source = null;
      sourceBitmap = null;
      onready?.(null);
    } finally {
      input.value = '';
    }
  }

  function updateZoom(next: number): void {
    if (!source) return;
    const centerX = crop.x + crop.size / 2;
    const centerY = crop.y + crop.size / 2;
    const minimum = Math.min(source.width, source.height) * 0.2;
    const maximum = Math.min(source.width, source.height);
    const size = maximum - (next / 100) * (maximum - minimum);
    crop = clampCrop({ x: centerX - size / 2, y: centerY - size / 2, size });
    zoom = next;
  }

  function clampCrop(next: SquareCrop): SquareCrop {
    if (!source) return next;
    return {
      size: next.size,
      x: Math.max(0, Math.min(source.width - next.size, next.x)),
      y: Math.max(0, Math.min(source.height - next.size, next.y))
    };
  }

  function renderSource(): void {
    if (!sourceBitmap) return;
    const context = sourceCanvas.getContext('2d');
    if (!context) return;
    const width = sourceCanvas.width;
    const height = sourceCanvas.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#050607';
    context.fillRect(0, 0, width, height);
    const scale = Math.min(width / sourceBitmap.width, height / sourceBitmap.height);
    const offsetX = (width - sourceBitmap.width * scale) / 2;
    const offsetY = (height - sourceBitmap.height * scale) / 2;
    display = { scale, offsetX, offsetY };
    context.drawImage(sourceBitmap, offsetX, offsetY, sourceBitmap.width * scale, sourceBitmap.height * scale);
    context.fillStyle = 'rgba(0,0,0,.56)';
    context.beginPath();
    context.rect(0, 0, width, height);
    context.rect(offsetX + crop.x * scale, offsetY + crop.y * scale, crop.size * scale, crop.size * scale);
    context.fill('evenodd');
    context.strokeStyle = '#c7ff45';
    context.lineWidth = 3;
    context.strokeRect(offsetX + crop.x * scale, offsetY + crop.y * scale, crop.size * scale, crop.size * scale);
  }

  function renderOutput(image: BadgeImage): void {
    const context = outputCanvas.getContext('2d');
    if (!context) return;
    const data = context.createImageData(128, 128);
    for (let index = 0; index < image.previewPixels.length; index += 1) {
      const value = image.previewPixels[index];
      const offset = index * 4;
      data.data[offset] = value;
      data.data[offset + 1] = value;
      data.data[offset + 2] = value;
      data.data[offset + 3] = 255;
    }
    context.putImageData(data, 0, 0);
  }

  function pointerDown(event: PointerEvent): void {
    if (!source) return;
    (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);
    drag = { x: event.clientX, y: event.clientY, cropX: crop.x, cropY: crop.y };
  }

  function pointerMove(event: PointerEvent): void {
    if (!drag) return;
    crop = clampCrop({
      ...crop,
      x: drag.cropX + (event.clientX - drag.x) / display.scale,
      y: drag.cropY + (event.clientY - drag.y) / display.scale
    });
  }

  function pointerUp(): void {
    drag = null;
  }
</script>

<div class="editor" class:has-image={source !== null}>
  <div class="canvas-column">
    <div class="canvas-label"><span>01</span> Crop</div>
    {#if source}
      <canvas
        class="source-canvas"
        bind:this={sourceCanvas}
        width="480"
        height="480"
        aria-label="Image crop area. Drag the square to reposition it."
        onpointerdown={pointerDown}
        onpointermove={pointerMove}
        onpointerup={pointerUp}
        onpointercancel={pointerUp}
      ></canvas>
      <strong class="filename">{filename}</strong>
    {:else}
      <label class="drop-zone">
        <span class="upload-icon" aria-hidden="true">↥</span>
        <strong>Choose an image</strong>
        <small>PNG, JPEG, WebP, or GIF</small>
        <input class="sr-only" type="file" accept="image/*" onchange={chooseFile} />
      </label>
    {/if}
  </div>

  <div class="controls-column">
    <div class="canvas-label"><span>02</span> Tune</div>
    <label>
      <span>Zoom</span>
      <output>{zoom}%</output>
      <input type="range" min="0" max="100" value={zoom} oninput={(event) => updateZoom(Number(event.currentTarget.value))} disabled={!source} />
    </label>
    <label>
      <span>Horizontal position</span>
      <output>{source ? Math.round(crop.x) : 0}</output>
      <input type="range" min="0" max={source ? Math.max(0, source.width - crop.size) : 0} step="0.1" bind:value={crop.x} disabled={!source} />
    </label>
    <label>
      <span>Vertical position</span>
      <output>{source ? Math.round(crop.y) : 0}</output>
      <input type="range" min="0" max={source ? Math.max(0, source.height - crop.size) : 0} step="0.1" bind:value={crop.y} disabled={!source} />
    </label>
    <label>
      <span>Threshold</span>
      <output>{threshold}</output>
      <input type="range" min="0" max="255" bind:value={threshold} disabled={!source} />
    </label>
    <fieldset disabled={!source}>
      <legend>Conversion</legend>
      <label class="radio"><input type="radio" bind:group={dither} value="floyd-steinberg" /> Dithered</label>
      <label class="radio"><input type="radio" bind:group={dither} value="threshold" /> Hard threshold</label>
    </fieldset>
    {#if source}
      <label class="replace">Choose another image<input class="sr-only" type="file" accept="image/*" onchange={chooseFile} /></label>
    {/if}
  </div>

  <div class="preview-column">
    <div class="canvas-label"><span>03</span> Badge preview</div>
    <div class="device-frame">
      <canvas bind:this={outputCanvas} width="128" height="128" aria-label="Exact monochrome badge preview"></canvas>
    </div>
    <small>128 × 128 · 1 BIT · 2,048 BYTES</small>
  </div>
</div>

{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
  .editor { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(220px, .7fr) minmax(220px, .7fr); gap: clamp(24px, 4vw, 54px); align-items: start; }
  .canvas-label { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; color: #d9dcda; font: 750 11px/1 ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; }
  .canvas-label span { color: var(--acid); }
  .source-canvas, .drop-zone { width: 100%; aspect-ratio: 1; border: 1px solid var(--line); background: #090b0d; }
  .source-canvas { display: block; cursor: move; touch-action: none; }
  .drop-zone { display: grid; place-content: center; justify-items: center; gap: 8px; min-height: 260px; cursor: pointer; text-align: center; border-style: dashed; }
  .drop-zone:hover { border-color: var(--acid); background: rgba(199,255,69,.025); }
  .upload-icon { display: grid; place-items: center; width: 48px; aspect-ratio: 1; margin-bottom: 8px; color: var(--acid); border: 1px solid #3b4430; font-size: 1.5rem; }
  .drop-zone small, .preview-column > small { color: var(--muted); font: 650 9px/1.4 ui-monospace, monospace; letter-spacing: .1em; }
  .filename { display: block; margin-top: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .78rem; }
  .controls-column { display: grid; gap: 20px; }
  .controls-column > label { display: grid; grid-template-columns: 1fr auto; gap: 10px; color: #b8bdba; font-size: .78rem; }
  output { color: var(--acid); font-family: ui-monospace, monospace; }
  input[type='range'] { grid-column: 1 / -1; width: 100%; accent-color: var(--acid); }
  fieldset { display: flex; flex-wrap: wrap; gap: 14px; padding: 0; border: 0; }
  legend { margin-bottom: 12px; color: #b8bdba; font-size: .78rem; }
  .radio { font-size: .76rem; color: var(--muted); }
  .replace { display: inline-block !important; color: var(--acid) !important; text-decoration: underline; cursor: pointer; }
  .preview-column { text-align: center; }
  .preview-column .canvas-label { justify-content: center; }
  .device-frame { width: min(100%, 260px); aspect-ratio: 1; margin: 0 auto 20px; padding: 14px; background: #252a2c; box-shadow: 14px 16px 0 #050607; }
  .device-frame canvas { display: block; width: 100%; height: 100%; background: #cbd5b5; image-rendering: pixelated; }
  .error { color: var(--danger); }
  @media (max-width: 860px) {
    .editor { grid-template-columns: 1fr 1fr; }
    .canvas-column { grid-row: span 2; }
  }
  @media (max-width: 620px) {
    .editor { grid-template-columns: 1fr; }
    .canvas-column { grid-row: auto; }
    .preview-column { grid-row: 2; }
    .controls-column { grid-row: 3; }
  }
</style>
