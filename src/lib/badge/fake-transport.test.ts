import { describe, expect, it } from 'vitest';

import { FakeBadgeTransport } from './fake-transport';
import { BadgeProtocolError, BadgeSession } from './transport';

const clearBatches = Array.from({ length: 8 }, () => '\b'.repeat(8));
const commandWrites = (command: string) => [...clearBatches, `${command}\n`];

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
