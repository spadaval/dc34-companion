<script lang="ts">
  import { onMount } from 'svelte';
  import ImageEditor from '$lib/components/ImageEditor.svelte';
  import type { BadgeImage } from '$lib/image/processing';
  import { BadgeSession } from '$lib/badge/transport';
  import { WebSerialTransport, type BrowserSerialMode } from '$lib/badge/web-serial';

  type ConnectionState = 'unsupported' | 'disconnected' | 'connecting' | 'connected';
  type ActionState = 'idle' | 'working' | 'success' | 'error';
  type AppTab = 'image' | 'diagnostics' | 'console';

  let connectionState = $state<ConnectionState>('disconnected');
  let actionState = $state<ActionState>('idle');
  let transport: WebSerialTransport | null = null;
  let session: BadgeSession | null = null;
  let firmware = $state('—');
  let badgeImage: BadgeImage | null = $state(null);
  let progress = $state(0);
  let statusMessage = $state('Connect your badge over USB to begin.');
  let consoleLines: string[] = $state([]);
  let showLog = $state(false);
  let hardwareResult: 'pass' | 'fail' | null = $state(null);
  let mounted = $state(false);
  let browserSupported = $state(false);
  let transportName = $state('Unavailable');
  let availableTransports: BrowserSerialMode[] = $state([]);
  let selectedTransport: BrowserSerialMode | null = $state(null);
  let activeTab: AppTab = $state('image');
  let connectionDialog: HTMLDialogElement;
  let consoleCommand = $state('');
  let transferLines: string[] = $state([]);
  let captureTransfer = $state(false);
  let hardwareCheckActive = false;

  onMount(() => {
    availableTransports = WebSerialTransport.availableModes();
    selectedTransport = availableTransports[0] ?? null;
    browserSupported = availableTransports.length > 0;
    transportName = WebSerialTransport.modeName(selectedTransport);
    mounted = true;
    if (!browserSupported) {
      connectionState = 'unsupported';
      statusMessage = 'This browser does not provide Web Serial or WebUSB.';
    }
  });

  function recordLine(line: string): void {
    if (!line.trim()) return;
    if (hardwareCheckActive && line.includes('HW.PASS')) hardwareResult = 'pass';
    if (hardwareCheckActive && line.includes('HW.FAIL')) hardwareResult = 'fail';
    consoleLines = [...consoleLines.slice(-79), line];
    if (captureTransfer) transferLines = [...transferLines.slice(-39), line];
  }

  function handleUnexpectedDisconnect(): void {
    transport = null;
    session = null;
    connectionState = 'disconnected';
    actionState = 'error';
    firmware = '—';
    progress = 0;
    statusMessage = 'Badge disconnected. Reconnect it to continue.';
  }

  async function connect(): Promise<void> {
    connectionState = 'connecting';
    statusMessage = 'Choose the DC34 badge in your browser prompt.';
    try {
      const nextTransport = new WebSerialTransport(handleUnexpectedDisconnect, selectedTransport ?? undefined);
      await nextTransport.connect();
      transport = nextTransport;
      transportName = nextTransport.name;
      session = new BadgeSession(nextTransport, recordLine);
      await readVersion();
      connectionState = 'connected';
      statusMessage = 'Badge connected at 1,000,000 baud.';
      connectionDialog?.close();
    } catch (cause) {
      connectionState = browserSupported ? 'disconnected' : 'unsupported';
      statusMessage = cause instanceof Error ? cause.message : 'Could not connect to the badge.';
      await transport?.close?.();
      transport = null;
      session = null;
    }
  }

  async function disconnect(): Promise<void> {
    await transport?.close?.();
    transport = null;
    session = null;
    connectionState = 'disconnected';
    firmware = '—';
    statusMessage = 'Badge disconnected.';
    progress = 0;
    connectionDialog?.close();
  }

  function openConnectionDialog(): void {
    connectionDialog?.showModal();
  }

  function selectTransport(mode: BrowserSerialMode): void {
    selectedTransport = mode;
    transportName = WebSerialTransport.modeName(mode);
  }

  async function readVersion(): Promise<boolean> {
    if (!session) return false;
    try {
      const result = await session.transact('ver xous', ['version'], { maxRetries: 0, timeoutMs: 4_000 });
      firmware = result.response.line.replace(/^Xous version:\s*/i, '') || result.response.line;
      return true;
    } catch (cause) {
      recordLine(`[companion] ${cause instanceof Error ? cause.message : 'Version query failed.'}`);
      firmware = 'Unavailable';
      return false;
    }
  }

  async function runHardwareCheck(): Promise<void> {
    if (!session || actionState === 'working') return;
    actionState = 'working';
    hardwareResult = null;
    showLog = true;
    statusMessage = 'Running the badge’s read-only hardware check…';
    try {
      await performHardwareCheck();
      actionState = hardwareResult === 'pass' ? 'success' : 'error';
      statusMessage = hardwareResult === 'pass' ? 'Hardware check passed.' : hardwareResult === 'fail' ? 'Hardware check reported a failure. Review the diagnostic log.' : 'Hardware check ended without a result marker.';
    } catch (cause) {
      actionState = 'error';
      statusMessage = cause instanceof Error ? cause.message : 'Hardware check failed.';
    }
  }

  async function performHardwareCheck(): Promise<void> {
    if (!session) return;
    hardwareCheckActive = true;
    hardwareResult = null;
    try {
      await session.transact('test hw', ['hardware-pass', 'hardware-fail', 'version'], {
        maxRetries: 0,
        timeoutMs: 30_000,
        completeOn: 'version'
      });
    } finally {
      hardwareCheckActive = false;
    }
  }

  async function refreshDiagnostics(): Promise<void> {
    if (!session || actionState === 'working') return;
    actionState = 'working';
    statusMessage = 'Refreshing diagnostics…';
    try {
      const versionAvailable = await readVersion();
      await performHardwareCheck();
      actionState = hardwareResult === 'pass' && versionAvailable ? 'success' : 'error';
      statusMessage = hardwareResult !== 'pass'
        ? 'Hardware check reported a failure.'
        : versionAvailable ? 'Diagnostics refreshed.' : 'Hardware passed; firmware version was not reported.';
    } catch (cause) {
      actionState = 'error';
      statusMessage = cause instanceof Error ? cause.message : 'Could not refresh diagnostics.';
    }
  }

  async function uploadImage(): Promise<void> {
    if (!session || !badgeImage || actionState === 'working') return;
    actionState = 'working';
    progress = 0;
    transferLines = [];
    captureTransfer = true;
    statusMessage = 'Uploading 32 chunks…';
    try {
      await session.uploadImage(badgeImage.payload, {
        onProgress: (completed, total) => (progress = completed / total)
      });
      progress = 1;
      actionState = 'success';
      statusMessage = 'Image uploaded. It will alternate with the DEF CON logo.';
    } catch (cause) {
      actionState = 'error';
      statusMessage = cause instanceof Error ? cause.message : 'Image upload failed.';
    } finally {
      captureTransfer = false;
    }
  }

  async function clearImage(): Promise<void> {
    if (!session || actionState === 'working') return;
    actionState = 'working';
    try {
      await session.clearImage();
      progress = 0;
      actionState = 'success';
      statusMessage = 'Custom image cleared from the badge.';
    } catch (cause) {
      actionState = 'error';
      statusMessage = cause instanceof Error ? cause.message : 'Could not clear the image.';
    }
  }

  async function sendConsoleCommand(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!session || actionState === 'working' || !consoleCommand.trim()) return;
    const command = consoleCommand;
    consoleCommand = '';
    actionState = 'working';
    statusMessage = `Running ${command}…`;
    try {
      await session.executeConsoleCommand(command);
      actionState = 'success';
      statusMessage = 'Command complete.';
    } catch (cause) {
      actionState = 'error';
      statusMessage = cause instanceof Error ? cause.message : 'Command failed.';
    }
  }

  const connected = $derived(connectionState === 'connected');
  const connectionLabel = $derived(
    connectionState === 'unsupported' ? 'Unsupported browser' :
    connectionState === 'connecting' ? 'Connecting…' :
    connectionState === 'connected' ? 'Connected' : 'Not connected'
  );
</script>

<svelte:head>
  <title>DC34 Companion</title>
  <meta name="description" content="Connect, inspect, and customize your DEF CON 34 badge from the browser." />
</svelte:head>

<div class="app-shell">
  <header class="topbar">
    <a class="brand" href="/" aria-label="DC34 Companion"><span class="mark">34</span><span>Companion</span></a>
    <button class="connection-button" type="button" onclick={openConnectionDialog} aria-haspopup="dialog" disabled={!mounted}>
      <span class:online={connected} class="pulse"></span>
      <span>{connectionLabel}</span>
      {#if connected && firmware !== 'Unavailable'}<small>{firmware}</small>{/if}
    </button>
  </header>

  <div class="tabs" role="tablist" aria-label="Tools">
    <button id="image-tab" type="button" role="tab" aria-selected={activeTab === 'image'} aria-controls="image-panel" onclick={() => (activeTab = 'image')}>Image</button>
    <button id="diagnostics-tab" type="button" role="tab" aria-selected={activeTab === 'diagnostics'} aria-controls="diagnostics-panel" onclick={() => (activeTab = 'diagnostics')}>Diagnostics</button>
    <button id="console-tab" type="button" role="tab" aria-selected={activeTab === 'console'} aria-controls="console-panel" onclick={() => (activeTab = 'console')}>Console</button>
  </div>

  <main>
    {#if activeTab === 'image'}
      <div id="image-panel" class="tool-panel" role="tabpanel" aria-labelledby="image-tab">
        <div class="panel-heading">
          <div><span class="kicker">128 × 128 · 1 BIT</span><h1>Image</h1></div>
          <span class:ready={badgeImage !== null} class="file-state">{badgeImage ? '2,048 bytes ready' : 'No image'}</span>
        </div>
        <ImageEditor onready={(image) => (badgeImage = image)} />
        <div class="actionbar" aria-live="polite">
          <div class="action-status">
            <strong>{statusMessage}</strong>
          </div>
          <div class="actions">
            <button class="secondary" type="button" onclick={clearImage} disabled={!connected || actionState === 'working'}>Clear badge</button>
            <button type="button" onclick={uploadImage} disabled={!connected || !badgeImage || actionState === 'working'}>
              {actionState === 'working' ? `${Math.round(progress * 100)}%` : 'Upload to badge'}
            </button>
          </div>
        </div>
        {#if transferLines.length || (actionState === 'working' && captureTransfer)}
          <div class="transfer-console">
            <div><span>Transfer console</span><span>{transferLines.length} lines</span></div>
            <pre aria-live="polite">{transferLines.length ? transferLines.join('\n') : 'Waiting for badge…'}</pre>
          </div>
        {/if}
      </div>
    {:else if activeTab === 'diagnostics'}
      <div id="diagnostics-panel" class="tool-panel" role="tabpanel" aria-labelledby="diagnostics-tab">
        <div class="panel-heading">
          <h1>Diagnostics</h1>
          <div class="heading-actions">
            <button class="secondary" type="button" onclick={runHardwareCheck} disabled={!connected || actionState === 'working'}>Hardware check</button>
            <button type="button" onclick={refreshDiagnostics} disabled={!connected || actionState === 'working'}>{actionState === 'working' ? 'Refreshing…' : 'Refresh all'}</button>
          </div>
        </div>
        <div class="diagnostic-grid">
          <article><span>Connection</span><strong class:good={connected}>{connectionLabel}</strong></article>
          <article><span>Firmware</span><strong>{firmware}</strong></article>
          <article><span>Transport</span><strong>{!mounted ? 'Checking…' : transportName}</strong></article>
          <article><span>Hardware</span><strong class:good={hardwareResult === 'pass'} class:bad={hardwareResult === 'fail'}>{hardwareResult ?? 'Not tested'}</strong></article>
        </div>
        <div class="log-panel">
          <button type="button" onclick={() => (showLog = !showLog)} aria-expanded={showLog}>
            <span>Console</span><span>{consoleLines.length} {showLog ? '−' : '+'}</span>
          </button>
          {#if showLog}
            <pre aria-live="polite">{consoleLines.length ? consoleLines.join('\n') : 'No output'}</pre>
          {/if}
        </div>
        <p class:success={actionState === 'success'} class:error={actionState === 'error'} class="result-message" aria-live="polite">{statusMessage}</p>
      </div>
    {:else}
      <div id="console-panel" class="tool-panel console-panel" role="tabpanel" aria-labelledby="console-tab">
        <div class="panel-heading">
          <div><span class="kicker">RAW SERIAL</span><h1>Console</h1></div>
          <button class="secondary" type="button" onclick={() => (consoleLines = [])} disabled={!consoleLines.length}>Clear output</button>
        </div>
        <div class="terminal">
          <pre aria-live="polite">{consoleLines.length ? consoleLines.join('\n') : 'No output'}</pre>
          <form onsubmit={sendConsoleCommand}>
            <label for="console-command">Command</label>
            <span aria-hidden="true">›</span>
            <input id="console-command" bind:value={consoleCommand} autocomplete="off" spellcheck="false" placeholder="ver xous" disabled={!connected || actionState === 'working'} />
            <button type="submit" disabled={!connected || actionState === 'working' || !consoleCommand.trim()}>Send</button>
          </form>
        </div>
        <p class="console-warning">Commands run directly on the badge and may change stored data.</p>
        <p class:error={actionState === 'error'} class="result-message" aria-live="polite">{statusMessage}</p>
      </div>
    {/if}
  </main>
</div>

<dialog class="connection-dialog" bind:this={connectionDialog} aria-labelledby="connection-title" oncancel={() => connectionDialog.close()}>
  <div class="dialog-heading">
    <div><span class="kicker">DEVICE</span><h2 id="connection-title">Connection</h2></div>
    <button class="icon-button" type="button" onclick={() => connectionDialog.close()} aria-label="Close connection dialog">×</button>
  </div>
  <div class="connection-summary" aria-live="polite">
    <span class:online={connected} class="pulse"></span>
    <div><strong>{connectionLabel}</strong><small>{statusMessage}</small></div>
  </div>
  {#if availableTransports.length}
    <fieldset class="transport-options" disabled={connected || connectionState === 'connecting'}>
      <legend>Transport</legend>
      {#each availableTransports as mode}
        <label class:selected={selectedTransport === mode} class="method-row">
          <input
            type="radio"
            name="transport"
            value={mode}
            checked={selectedTransport === mode}
            onchange={() => selectTransport(mode)}
          />
          <div>
            <strong>{WebSerialTransport.modeName(mode)}</strong>
            <small>{mode === 'web-serial' ? 'System serial port' : 'Direct USB CDC fallback'}</small>
          </div>
          <span>Available</span>
        </label>
      {/each}
    </fieldset>
  {/if}
  {#if connectionState === 'unsupported'}
    <p class="support-note">Use current Chrome or Edge on desktop, or Chrome with USB host support on Android.</p>
  {/if}
  <div class="dialog-actions">
    {#if connected}
      <button class="danger-button" type="button" onclick={disconnect}>Disconnect</button>
    {:else}
      <button type="button" onclick={connect} disabled={!mounted || !browserSupported || connectionState === 'connecting'}>
        {connectionState === 'connecting' ? 'Connecting…' : 'Connect badge'}
      </button>
    {/if}
  </div>
</dialog>

<style>
  header { display: flex; align-items: center; justify-content: space-between; }
  .brand { display: flex; gap: 12px; align-items: center; color: inherit; text-decoration: none; font-weight: 800; letter-spacing: -.02em; }
  .mark { display: grid; place-items: center; width: 34px; aspect-ratio: 1; color: var(--ink); background: var(--acid); font: 900 14px/1 ui-monospace, monospace; transform: rotate(-3deg); }
  .pulse { flex: 0 0 auto; width: 9px; aspect-ratio: 1; border-radius: 50%; background: #596067; box-shadow: 0 0 0 5px rgba(89,96,103,.12); }
  .pulse.online { background: var(--acid); box-shadow: 0 0 0 5px rgba(199,255,69,.12), 0 0 18px rgba(199,255,69,.3); }
  button { border: 0; padding: 0 18px; font-weight: 800; background: var(--acid); color: var(--ink); cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: .38; }
  .secondary { color: #d8dcda; background: transparent; border: 1px solid #42494d; }
  .diagnostic-grid { display: grid; grid-template-columns: repeat(4,1fr); border: solid var(--line); border-width: 1px 0 0 1px; }
  .diagnostic-grid article { min-height: 132px; display: flex; flex-direction: column; justify-content: space-between; padding: 20px; border: solid var(--line); border-width: 0 1px 1px 0; }
  .diagnostic-grid span { color: #7f888e; font: 650 10px/1 ui-monospace, monospace; text-transform: uppercase; letter-spacing: .1em; }
  .diagnostic-grid strong { font-size: 1rem; overflow-wrap: anywhere; }
  .diagnostic-grid strong.good { color: var(--acid); }
  .log-panel { margin-top: 14px; border: 1px solid var(--line); }
  .log-panel > button { display: flex; width: 100%; justify-content: space-between; color: #aeb4b6; background: #111416; font: 700 11px/1 ui-monospace, monospace; letter-spacing: .08em; }
  pre { max-height: 280px; overflow: auto; margin: 0; padding: 18px; color: #aeb8a2; background: #050607; font: 11px/1.65 ui-monospace, monospace; white-space: pre-wrap; }
  .app-shell { min-height: 100vh; }
  .topbar { position: sticky; top: 0; z-index: 20; min-height: 64px; padding: 0 max(20px, calc((100vw - 1240px) / 2)); border-bottom: 1px solid var(--line); background: rgba(9,11,13,.94); backdrop-filter: blur(16px); }
  .topbar .brand { gap: 10px; }
  .topbar .mark { width: 30px; }
  .connection-button { display: flex; align-items: center; gap: 10px; min-height: 38px; padding: 0 13px; color: #e5e8e3; border: 1px solid #394045; background: #141719; }
  .connection-button:hover { border-color: #596168; }
  .connection-button small { max-width: 220px; overflow: hidden; color: var(--muted); font: 600 10px/1 ui-monospace, monospace; text-overflow: ellipsis; white-space: nowrap; }
  .tabs { position: sticky; top: 64px; z-index: 15; display: flex; gap: 4px; padding: 12px max(20px, calc((100vw - 1240px) / 2)); border-bottom: 1px solid var(--line); background: rgba(9,11,13,.94); backdrop-filter: blur(16px); }
  .tabs button { min-height: 38px; padding: 0 16px; color: #8d959a; background: transparent; border: 1px solid transparent; }
  .tabs button[aria-selected='true'] { color: var(--acid); border-color: #3c4631; background: rgba(199,255,69,.06); }
  .app-shell main { width: min(1240px, calc(100% - 40px)); margin: 0 auto; padding: 32px 0 72px; }
  .tool-panel { margin: 0; }
  .panel-heading { display: flex; align-items: end; justify-content: space-between; gap: 24px; min-height: 74px; margin-bottom: 24px; }
  .panel-heading h1, .dialog-heading h2 { margin: 0; font-size: clamp(2rem, 4vw, 3.4rem); line-height: 1; letter-spacing: -.045em; }
  .kicker { display: block; margin-bottom: 8px; color: var(--acid); font: 700 9px/1 ui-monospace, monospace; letter-spacing: .14em; }
  .file-state { color: var(--muted); font: 650 11px/1 ui-monospace, monospace; text-transform: uppercase; }
  .file-state.ready { color: var(--acid); }
  .actionbar { position: sticky; bottom: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 78px; margin-top: 32px; padding: 14px 0; border-top: 1px solid var(--line); background: rgba(9,11,13,.96); backdrop-filter: blur(14px); }
  .action-status { display: grid; gap: 8px; min-width: 0; color: #b8beb9; font-size: .78rem; }
  .action-status strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .actions { display: flex; gap: 10px; flex: 0 0 auto; }
  .actions button { min-width: 104px; }
  .heading-actions { display: flex; gap: 10px; }
  .transfer-console { margin-top: 20px; border: 1px solid var(--line); }
  .transfer-console > div { display: flex; justify-content: space-between; padding: 10px 14px; color: var(--muted); background: #111416; font: 700 10px/1 ui-monospace, monospace; text-transform: uppercase; }
  .transfer-console pre { max-height: 240px; overflow: auto; white-space: pre; }
  .diagnostic-grid { grid-template-columns: repeat(4, minmax(0,1fr)); }
  .diagnostic-grid article { min-height: 116px; background: var(--panel); }
  .diagnostic-grid .bad { color: var(--danger); }
  .result-message { min-height: 24px; color: var(--muted); font-size: .8rem; }
  .result-message.success { color: var(--acid); }
  .result-message.error { color: var(--danger); }
  .terminal { overflow: hidden; border: 1px solid var(--line); background: #050607; }
  .terminal pre { min-height: min(54vh, 480px); max-height: 54vh; }
  .terminal form { display: grid; grid-template-columns: auto auto minmax(0,1fr) auto; align-items: center; gap: 10px; padding: 12px; border-top: 1px solid var(--line); background: #0d1012; }
  .terminal form label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .terminal form > span { color: var(--acid); font: 800 18px/1 ui-monospace, monospace; }
  .terminal input { width: 100%; min-height: 42px; padding: 0 12px; color: #edf0e9; border: 1px solid #343a3e; background: #080a0b; font: 13px/1 ui-monospace, monospace; }
  .console-warning { color: var(--danger); font-size: .72rem; }
  .connection-dialog { width: min(480px, calc(100% - 28px)); padding: 0; color: #f3f4ee; border: 1px solid #464d52; background: #111416; box-shadow: 0 24px 100px rgba(0,0,0,.68); }
  .connection-dialog::backdrop { background: rgba(1,2,3,.76); backdrop-filter: blur(4px); }
  .dialog-heading { display: flex; align-items: start; justify-content: space-between; padding: 24px; border-bottom: 1px solid var(--line); }
  .dialog-heading h2 { font-size: 2rem; }
  .icon-button { min-width: 40px; min-height: 40px; padding: 0; color: #abb2b6; background: transparent; font-size: 1.7rem; }
  .connection-summary { display: flex; align-items: center; gap: 14px; padding: 24px; }
  .connection-summary div, .method-row div { display: grid; gap: 6px; }
  .connection-summary small, .method-row small { color: var(--muted); line-height: 1.4; }
  .transport-options { display: grid; gap: 8px; margin: 0 24px; padding: 0; border: 0; }
  .transport-options legend { margin-bottom: 10px; color: var(--muted); font: 700 10px/1 ui-monospace, monospace; text-transform: uppercase; }
  .method-row { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 14px; padding: 16px; border: 1px solid #3a4246; background: #0b0d0f; cursor: pointer; }
  .method-row.selected { border-color: var(--acid); }
  .method-row input { width: 16px; height: 16px; margin: 0; accent-color: var(--acid); }
  .method-row > span { color: var(--acid); font: 700 9px/1 ui-monospace, monospace; text-transform: uppercase; }
  .support-note { margin: 16px 24px 0; color: var(--muted); font-size: .76rem; line-height: 1.5; }
  .dialog-actions { display: flex; justify-content: flex-end; padding: 24px; }
  .dialog-actions button { width: 100%; }
  .danger-button { color: #fff; background: #512522; }
  @media (max-width: 760px) {
    .app-shell main { width: min(100% - 28px, 620px); padding-top: 20px; }
    .topbar { padding-inline: 14px; }
    .tabs { padding: 9px 14px; }
    .connection-button small { display: none; }
    .panel-heading { min-height: 58px; }
    .diagnostic-grid { grid-template-columns: 1fr 1fr; }
    .actionbar { align-items: stretch; flex-direction: column; gap: 12px; padding-bottom: max(14px, env(safe-area-inset-bottom)); }
    .action-status strong { white-space: normal; }
    .actions { display: grid; grid-template-columns: 1fr 1.5fr; }
    .heading-actions { display: grid; grid-template-columns: 1fr 1fr; width: 100%; }
    .diagnostic-grid + .log-panel { margin-top: 12px; }
    .terminal pre { min-height: 46vh; }
  }
  @media (max-width: 430px) {
    .brand > span:last-child { display: none; }
    .diagnostic-grid { grid-template-columns: 1fr; }
    .panel-heading { align-items: start; }
    #diagnostics-panel .panel-heading { flex-direction: column; }
    .terminal form { grid-template-columns: auto minmax(0,1fr); }
    .terminal form button { grid-column: 1 / -1; }
  }
</style>
