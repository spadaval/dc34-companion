<script lang="ts">
  import { unpackBadgePayload } from '$lib/image/processing';

  let { payload }: { payload: Uint8Array | null } = $props();
  let canvas: HTMLCanvasElement = $state()!;

  $effect(() => {
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const pixels = payload ? unpackBadgePayload(payload) : new Uint8Array(128 * 128).fill(255);
    const image = context.createImageData(128, 128);
    for (let index = 0; index < pixels.length; index += 1) {
      const offset = index * 4;
      image.data[offset] = pixels[index];
      image.data[offset + 1] = pixels[index];
      image.data[offset + 2] = pixels[index];
      image.data[offset + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  });
</script>

<aside class="virtual-display" aria-label="Virtual badge display">
  <div>
    <span>VIRTUAL DISPLAY</span>
    <strong>{payload ? 'Custom image stored' : 'No custom image'}</strong>
  </div>
  <canvas bind:this={canvas} width="128" height="128" aria-label="Image stored on the virtual badge"></canvas>
</aside>

<style>
  .virtual-display { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-top: 18px; padding: 18px; border: 1px solid #3d4930; background: rgba(199,255,69,.035); }
  .virtual-display div { display: grid; gap: 8px; }
  span { color: var(--acid); font: 700 9px/1 ui-monospace, monospace; letter-spacing: .13em; }
  strong { font-size: .86rem; }
  canvas { width: 96px; height: 96px; flex: 0 0 auto; background: #cbd5b5; image-rendering: pixelated; border: 8px solid #252a2c; }
  @media (max-width: 430px) { canvas { width: 80px; height: 80px; } }
</style>
