import { expect, test } from '@playwright/test';

async function installFakeBadge(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let imageChunks = 0;
    const readable = new ReadableStream<Uint8Array>({ start(next) { controller = next; } });
    const writable = new WritableStream<Uint8Array>({
      write(bytes) {
        const command = new TextDecoder().decode(bytes).replace(/^\x08+/, '').trim();
        if (!command) return;
        controller.enqueue(encoder.encode(`[console] ${command}\n`));
        if (command === 'ver xous') controller.enqueue(encoder.encode('Xous version: test-1.0\n'));
        else if (command.startsWith('echo ')) controller.enqueue(encoder.encode(`${command.slice(5)}\n`));
        else if (command === 'image clear') {
          imageChunks = 0;
          controller.enqueue(encoder.encode('CLEAR\n'));
        } else if (command.startsWith('image ')) {
          imageChunks += 1;
          controller.enqueue(encoder.encode(imageChunks === 32 ? 'SUCCESS\n' : 'OK\n'));
        } else if (command === 'test hw') controller.enqueue(encoder.encode('_|TT|_HW.PASS,_|TE|_\nXous version: test-1.0\n'));
      }
    });
    const port = { readable, writable, open: async () => {}, close: async () => controller.close() };
    Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort: async () => port, getPorts: async () => [] } });
  });
}

test('connects, reads diagnostics, prepares an image, and uploads it', async ({ page }) => {
  await installFakeBadge(page);
  await page.goto('/');

  await expect(page.getByRole('tab', { name: 'Image' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: /Not connected/ }).click();
  await expect(page.getByRole('dialog', { name: 'Connection' })).toBeVisible();
  await page.getByRole('button', { name: 'Connect badge' }).click();
  await expect(page.getByText('test-1.0')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Connection' })).toBeHidden();
  await expect(page.getByRole('button', { name: /Connected/ })).toBeVisible();

  const png = await page.screenshot();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'badge.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText('2,048 bytes ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Upload to badge' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Image' }).getByText('Image uploaded. It will alternate with the DEF CON logo.')).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText('Transfer console')).toBeVisible();
  await expect(page.locator('.transfer-console pre')).toContainText('SUCCESS');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Image' }).getByText('Custom image cleared from the badge.')).toBeVisible();

  await page.getByRole('tab', { name: 'Diagnostics' }).click();
  await page.getByRole('button', { name: 'Refresh all' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Diagnostics' }).getByText('Diagnostics refreshed.')).toBeVisible();

  await page.getByRole('tab', { name: 'Console' }).click();
  await page.getByLabel('Command').fill('echo hello');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Console' }).locator('pre')).toContainText('hello');
});

test('offers WebUSB when native Web Serial is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serial', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'usb', { configurable: true, value: {} });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Not connected/ }).click();
  await expect(page.getByRole('dialog', { name: 'Connection' })).toBeVisible();
  await expect(page.getByText('WebUSB · CDC')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect badge' })).toBeEnabled();
});

test('shows useful guidance when browser USB APIs are unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serial', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'usb', { configurable: true, value: undefined });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Unsupported/ }).click();
  await expect(page.getByRole('dialog', { name: 'Connection' })).toBeVisible();
  await expect(page.getByText(/USB host support on Android/)).toBeVisible();
});

test('uses the mobile layout without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(hasOverflow).toBe(false);
  await expect(page.getByRole('tablist', { name: 'Tools' })).toBeVisible();
});
