import { describe, expect, it } from 'vitest';

import { FakeBadgeTransport } from './fake-transport';
import { IMAGE_BYTES } from './protocol';
import { BadgeProtocolError, BadgeSession } from './transport';

const commandWrites = (command: string) => `${command}\n`.match(/.{1,8}/gs) ?? [];

describe('FakeBadgeTransport with BadgeSession', () => {
	it('ignores echoes and logs before accepting a response', async () => {
		const transport = new FakeBadgeTransport();
		transport.enqueueText('[console] image clear\nstatus: idle\nCLEAR\n');
		const session = new BadgeSession(transport);

		await expect(session.clearImage({ timeoutMs: 50, maxRetries: 0 })).resolves.toMatchObject({
			response: { kind: 'clear' },
			attempt: 0
		});
		expect(transport.writes.map((bytes) => new TextDecoder().decode(bytes))).toEqual(commandWrites('image clear'));
	});

	it('retries a rejected transaction and preserves command framing', async () => {
		const transport = new FakeBadgeTransport();
		transport.enqueueText('ERR\nOK\n');
		const session = new BadgeSession(transport);

		await expect(session.transact('ver', ['ok'], { timeoutMs: 50, maxRetries: 1, retryDelayMs: 0 })).resolves.toMatchObject({
			response: { kind: 'ok' },
			attempt: 1
		});
		expect(transport.writes.map((bytes) => new TextDecoder().decode(bytes))).toEqual([
			...commandWrites('ver'),
			...commandWrites('ver')
		]);
	});

	it('runs an arbitrary console command and collects output until the console becomes idle', async () => {
		const transport = new FakeBadgeTransport();
		transport.enqueueText('[console] echo hello\nhello\n');
		const session = new BadgeSession(transport);

		await expect(session.executeConsoleCommand('echo hello', { timeoutMs: 50, idleMs: 5 })).resolves.toEqual([
			'[console] echo hello',
			'hello'
		]);
		expect(transport.writes.map((bytes) => new TextDecoder().decode(bytes))).toEqual(commandWrites('echo hello'));
	});

	it('uploads using dc34-image framing without clears or backspaces', async () => {
		const transport = new FakeBadgeTransport();
		transport.enqueueText(`ready\nready\nready\n${'OK\n'.repeat(31)}SUCCESS\n`);
		const session = new BadgeSession(transport);

		await expect(session.uploadImage(new Uint8Array(IMAGE_BYTES), {
			timeoutMs: 50,
			maxRetries: 0,
			chunkDelayMs: 0
		})).resolves.toBeUndefined();

		const writes = transport.writes.map((bytes) => new TextDecoder().decode(bytes));
		expect(writes.slice(0, 3)).toEqual(['\r\n', '\r\n', '\r\n']);
		expect(writes.slice(3).every((write) => write.length <= 8)).toBe(true);
		expect(writes.slice(3).filter((write) => write.endsWith('\n'))).toHaveLength(32);
		expect(writes.join('')).not.toContain('\b');
		expect(writes.join('')).not.toContain('image clear\n');
	});

	it('rejects multiline console input', async () => {
		const session = new BadgeSession(new FakeBadgeTransport());
		await expect(session.executeConsoleCommand('echo ok\nimage clear')).rejects.toThrow('one line');
	});

	it('reports an unexpected terminal response', async () => {
		const transport = new FakeBadgeTransport();
		transport.enqueueText('OK\n');
		const session = new BadgeSession(transport);
		await expect(session.clearImage({ timeoutMs: 50, maxRetries: 0 })).rejects.toBeInstanceOf(BadgeProtocolError);
	});

	it('drains the hardware result and final version before the next transaction', async () => {
		const transport = new FakeBadgeTransport();
		transport.enqueueText('_|TT|_HW.PASS,_|TE|_\nXous version: test-1.0\nCLEAR\n');
		const session = new BadgeSession(transport);

		await expect(session.transact('test hw', ['hardware-pass', 'hardware-fail', 'version'], {
			timeoutMs: 50,
			maxRetries: 0,
			completeOn: 'version'
		})).resolves.toMatchObject({ response: { kind: 'version' } });
		await expect(session.clearImage({ timeoutMs: 50, maxRetries: 0 })).resolves.toMatchObject({
			response: { kind: 'clear' }
		});
	});
});
