import { expect, test } from '@playwright/test';

async function installFakeBadge(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let imageChunks = 0;
    const readable = new ReadableStream<Uint8Array>({ start(next) { controller = next; } });
    const writable = new WritableStream<Uint8Array>({
      write(bytes) {
        const command = new TextDecoder().decode(bytes).trim();
        controller.enqueue(encoder.encode(`[console] ${command}\n`));
        if (command === 'ver xous') controller.enqueue(encoder.encode('Xous version: test-1.0\n'));
        else if (command === 'image clear') {
          imageChunks = 0;
          controller.enqueue(encoder.encode('CLEAR\n'));
        } else if (command.startsWith('image ')) {
          imageChunks += 1;
          controller.enqueue(encoder.encode(imageChunks === 32 ? 'SUCCESS\n' : 'OK\n'));
        } else if (command === 'test hw') controller.enqueue(encoder.encode('_|TT|_HW.PASS,_|TE|_\n'));
      }
    });
    const port = { readable, writable, open: async () => {}, close: async () => controller.close() };
    Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort: async () => port, getPorts: async () => [] } });
  });
}

test('connects, reads diagnostics, prepares an image, and uploads it', async ({ page }) => {
  await installFakeBadge(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Connect badge' }).click();
  await expect(page.getByText('test-1.0')).toBeVisible();
  await expect(page.getByText('Connected', { exact: true }).first()).toBeVisible();

  const png = await page.screenshot();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'badge.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText('Image ready', { exact: true })).toBeVisible();
  await expect(page.getByText('2,048 bytes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Upload to badge' }).click();
  await expect(page.getByText('Image uploaded. It will alternate with the DEF CON logo.')).toBeVisible({ timeout: 12_000 });
});

test('shows useful guidance when Web Serial is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serial', { configurable: true, value: undefined });
  });
  await page.goto('/');
  await expect(page.getByText('Unsupported browser', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Use current Chrome or Edge/)).toBeVisible();
});

test('uses the mobile layout without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(hasOverflow).toBe(false);
  await expect(page.getByRole('heading', { name: 'Turn anything into badge art.' })).toBeVisible();
});
