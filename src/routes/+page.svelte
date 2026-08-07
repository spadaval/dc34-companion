<script lang="ts">
  import { onMount } from 'svelte';
  import ImageEditor from '$lib/components/ImageEditor.svelte';
  import type { BadgeImage } from '$lib/image/processing';
  import { BadgeSession } from '$lib/badge/transport';
  import { WebSerialTransport } from '$lib/badge/web-serial';

  type ConnectionState = 'unsupported' | 'disconnected' | 'connecting' | 'connected';
  type ActionState = 'idle' | 'working' | 'success' | 'error';

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
  let hardwareResult: 'pass' | 'fail' | null = null;
  let mounted = $state(false);
  let browserSupported = $state(false);

  onMount(() => {
    browserSupported = WebSerialTransport.supported();
    mounted = true;
    if (!browserSupported) {
      connectionState = 'unsupported';
      statusMessage = 'This browser does not provide Web Serial.';
    }
  });

  function recordLine(line: string): void {
    if (!line.trim()) return;
    if (line.includes('HW.PASS')) hardwareResult = 'pass';
    if (line.includes('HW.FAIL')) hardwareResult = 'fail';
    consoleLines = [...consoleLines.slice(-79), line];
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
    statusMessage = 'Choose the DC34 serial port in your browser prompt.';
    try {
      const nextTransport = new WebSerialTransport(handleUnexpectedDisconnect);
      await nextTransport.connect();
      transport = nextTransport;
      session = new BadgeSession(nextTransport, recordLine);
      await readVersion();
      connectionState = 'connected';
      statusMessage = 'Badge connected at 1,000,000 baud.';
    } catch (cause) {
      connectionState = browserSupported ? 'disconnected' : 'unsupported';
      statusMessage = cause instanceof Error ? cause.message : 'Could not connect to the badge.';
      await transport?.close();
      transport = null;
      session = null;
    }
  }

  async function disconnect(): Promise<void> {
    await transport?.close();
    transport = null;
    session = null;
    connectionState = 'disconnected';
    firmware = '—';
    statusMessage = 'Badge disconnected.';
    progress = 0;
  }

  async function readVersion(): Promise<void> {
    if (!session) return;
    try {
      const result = await session.transact('ver xous', ['version'], { maxRetries: 0, timeoutMs: 4_000 });
      firmware = result.response.line.replace(/^Xous version:\s*/i, '') || result.response.line;
    } catch (cause) {
      recordLine(`[companion] ${cause instanceof Error ? cause.message : 'Version query failed.'}`);
      firmware = 'Unavailable';
    }
  }

  async function runHardwareCheck(): Promise<void> {
    if (!session || actionState === 'working') return;
    actionState = 'working';
    hardwareResult = null;
    showLog = true;
    statusMessage = 'Running the badge’s read-only hardware check…';
    try {
      await session.transact('test hw', ['hardware-pass', 'hardware-fail', 'version'], {
        maxRetries: 0,
        timeoutMs: 30_000,
        completeOn: 'version'
      });
      actionState = hardwareResult === 'pass' ? 'success' : 'error';
      statusMessage = hardwareResult === 'pass' ? 'Hardware check passed.' : hardwareResult === 'fail' ? 'Hardware check reported a failure. Review the diagnostic log.' : 'Hardware check ended without a result marker.';
    } catch (cause) {
      actionState = 'error';
      statusMessage = cause instanceof Error ? cause.message : 'Hardware check failed.';
    }
  }

  async function uploadImage(): Promise<void> {
    if (!session || !badgeImage || actionState === 'working') return;
    actionState = 'working';
    progress = 0;
    statusMessage = 'Clearing any partial transfer and uploading 32 chunks…';
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

<div class="page-shell">
  <header>
    <a class="brand" href="/" aria-label="DC34 Companion home"><span class="mark">34</span><span>DC34 Companion</span></a>
    <nav aria-label="Page sections"><a href="#diagnostics">Diagnostics</a><a href="#image">Image</a></nav>
    <span class="privacy">LOCAL-ONLY</span>
  </header>

  <main>
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">YOUR BADGE, YOUR CANVAS</p>
        <h1>Meet your badge<br />on its own terms.</h1>
        <p class="lede">Inspect your DC34 badge and turn any image into display-ready pixel art. Processing happens entirely in your browser.</p>
      </div>

      <aside class="connect-card" aria-live="polite">
        <div class="connection-state">
          <span class:online={connected} class="pulse"></span>
          <div><strong>{connectionLabel}</strong><small>{statusMessage}</small></div>
        </div>
        {#if connected}
          <button class="secondary" type="button" onclick={disconnect}>Disconnect</button>
        {:else}
          <button type="button" onclick={connect} disabled={!mounted || connectionState === 'unsupported' || connectionState === 'connecting'}>
            {connectionState === 'connecting' ? 'Connecting…' : 'Connect badge'} <span aria-hidden="true">→</span>
          </button>
        {/if}
        {#if connectionState === 'unsupported'}
          <p>Use current Chrome or Edge on desktop. Android support depends on the phone and browser.</p>
        {:else}
          <p>Your browser will ask you to choose and approve a serial device.</p>
        {/if}
      </aside>
    </section>

    <section id="diagnostics" aria-labelledby="diagnostics-heading">
      <div class="section-heading">
        <div><p class="eyebrow">AT A GLANCE</p><h2 id="diagnostics-heading">Diagnostics</h2></div>
        <button class="text-button" type="button" onclick={runHardwareCheck} disabled={!connected || actionState === 'working'}>Run hardware check</button>
      </div>
      <div class="diagnostic-grid">
        <article><span>Connection</span><strong class:good={connected}>{connectionLabel}</strong></article>
        <article><span>Firmware</span><strong>{firmware}</strong></article>
        <article><span>Transport</span><strong>{!mounted ? 'Checking…' : browserSupported ? 'Web Serial' : 'Unavailable'}</strong></article>
        <article><span>Prepared image</span><strong>{badgeImage ? '2,048 bytes' : 'None'}</strong></article>
      </div>
      <div class="log-panel" class:open={showLog}>
        <button type="button" onclick={() => (showLog = !showLog)} aria-expanded={showLog}>
          <span>Diagnostic log</span><span>{consoleLines.length} lines {showLog ? '−' : '+'}</span>
        </button>
        {#if showLog}
          <pre aria-live="polite">{consoleLines.length ? consoleLines.join('\n') : 'Connect a badge or run a check to see output.'}</pre>
        {/if}
      </div>
    </section>

    <section id="image" class="image-section" aria-labelledby="image-heading">
      <div class="image-intro">
        <div><p class="eyebrow">DISPLAY WORKSHOP</p><h2 id="image-heading">Turn anything into badge art.</h2></div>
        <p>Crop, tune, and dither locally. The preview shows the exact black-and-white pixels sent to the badge.</p>
      </div>
      <ImageEditor onready={(image) => (badgeImage = image)} />
      <div class="upload-bar">
        <div class="upload-status">
          <span>{badgeImage ? 'Image ready' : 'Choose an image to begin'}</span>
          <small>{connected ? 'Badge connected' : 'Connect a badge before uploading'}</small>
          {#if actionState === 'working' && progress > 0}
            <progress max="1" value={progress}>{Math.round(progress * 100)}%</progress>
          {/if}
        </div>
        <div class="upload-actions">
          <button class="secondary" type="button" onclick={clearImage} disabled={!connected || actionState === 'working'}>Clear badge image</button>
          <button type="button" onclick={uploadImage} disabled={!connected || !badgeImage || actionState === 'working'}>
            {actionState === 'working' ? `Uploading ${Math.round(progress * 100)}%` : 'Upload to badge'}
          </button>
        </div>
      </div>
    </section>

    <section class="about">
      <p class="eyebrow">HOW IT WORKS</p>
      <div class="steps"><article><span>01</span><h3>Connect</h3><p>Grant this page access to the badge’s USB serial interface.</p></article><article><span>02</span><h3>Prepare</h3><p>Your image is cropped and converted locally into 16,384 one-bit pixels.</p></article><article><span>03</span><h3>Send</h3><p>The app verifies and retries each of the badge’s 32 image chunks.</p></article></div>
    </section>
  </main>

  <footer><span>Built for curious humans at DEF CON 34.</span><span>No uploads. No tracking. <a href="https://github.com/spadaval/dc34-companion">View source</a></span></footer>
</div>

<style>
  .page-shell { width: min(1160px, calc(100% - 40px)); margin: 0 auto; min-height: 100vh; }
  header, footer { display: flex; align-items: center; justify-content: space-between; }
  header { min-height: 84px; border-bottom: 1px solid #25292d; }
  .brand { display: flex; gap: 12px; align-items: center; color: inherit; text-decoration: none; font-weight: 800; letter-spacing: -.02em; }
  .mark { display: grid; place-items: center; width: 34px; aspect-ratio: 1; color: var(--ink); background: var(--acid); font: 900 14px/1 ui-monospace, monospace; transform: rotate(-3deg); }
  nav { display: flex; gap: 28px; }
  nav a, footer a { color: #aab0b3; font-size: .8rem; }
  .privacy { color: var(--acid); font: 700 10px/1 ui-monospace, monospace; letter-spacing: .14em; }
  main { padding: 80px 0 100px; }
  .hero { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(310px, .65fr); gap: 70px; align-items: end; padding-bottom: 96px; }
  .eyebrow { margin: 0 0 18px; color: var(--acid); font: 750 11px/1 ui-monospace, monospace; letter-spacing: .16em; }
  h1, h2 { margin: 0; letter-spacing: -.055em; line-height: .98; }
  h1 { max-width: 760px; font-size: clamp(3.2rem, 8vw, 6.9rem); }
  h2 { font-size: clamp(2.2rem, 5vw, 4rem); }
  .lede { max-width: 650px; margin: 30px 0 0; color: #abb1b5; font-size: clamp(1rem, 2vw, 1.2rem); line-height: 1.65; }
  .connect-card { padding: 24px; border: 1px solid var(--line); background: rgba(17,20,22,.92); box-shadow: 0 18px 60px rgba(0,0,0,.28); }
  .connection-state { display: flex; gap: 14px; align-items: center; min-height: 48px; }
  .pulse { flex: 0 0 auto; width: 9px; aspect-ratio: 1; border-radius: 50%; background: #596067; box-shadow: 0 0 0 5px rgba(89,96,103,.12); }
  .pulse.online { background: var(--acid); box-shadow: 0 0 0 5px rgba(199,255,69,.12), 0 0 18px rgba(199,255,69,.3); }
  .connection-state div { display: grid; gap: 5px; }
  .connection-state small, .connect-card p { color: #858d92; line-height: 1.4; }
  button { border: 0; padding: 0 18px; font-weight: 800; background: var(--acid); color: var(--ink); cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: .38; }
  .connect-card > button { width: 100%; display: flex; justify-content: space-between; align-items: center; margin-top: 26px; }
  .connect-card p { margin: 13px 0 0; font-size: .72rem; text-align: center; }
  .secondary { color: #d8dcda; background: transparent; border: 1px solid #42494d; }
  section + section { margin-top: 110px; }
  .section-heading, .image-intro { display: flex; align-items: end; justify-content: space-between; gap: 30px; margin-bottom: 30px; }
  .text-button { min-height: 34px; padding: 0; color: var(--acid); background: none; text-decoration: underline; }
  .diagnostic-grid { display: grid; grid-template-columns: repeat(4,1fr); border: solid var(--line); border-width: 1px 0 0 1px; }
  .diagnostic-grid article { min-height: 132px; display: flex; flex-direction: column; justify-content: space-between; padding: 20px; border: solid var(--line); border-width: 0 1px 1px 0; }
  .diagnostic-grid span { color: #7f888e; font: 650 10px/1 ui-monospace, monospace; text-transform: uppercase; letter-spacing: .1em; }
  .diagnostic-grid strong { font-size: 1rem; overflow-wrap: anywhere; }
  .diagnostic-grid strong.good { color: var(--acid); }
  .log-panel { margin-top: 14px; border: 1px solid var(--line); }
  .log-panel > button { display: flex; width: 100%; justify-content: space-between; color: #aeb4b6; background: #111416; font: 700 11px/1 ui-monospace, monospace; letter-spacing: .08em; }
  pre { max-height: 280px; overflow: auto; margin: 0; padding: 18px; color: #aeb8a2; background: #050607; font: 11px/1.65 ui-monospace, monospace; white-space: pre-wrap; }
  .image-section { padding: clamp(30px,6vw,70px); border: 1px solid var(--line); background: var(--panel); }
  .image-intro > p { max-width: 390px; margin: 0; color: var(--muted); line-height: 1.65; }
  .upload-bar { display: flex; justify-content: space-between; align-items: center; gap: 25px; margin-top: 56px; padding-top: 26px; border-top: 1px solid var(--line); }
  .upload-status { display: grid; gap: 5px; min-width: min(320px,100%); }
  .upload-status span { font-weight: 800; }
  .upload-status small { color: var(--muted); }
  progress { width: 100%; height: 6px; margin-top: 10px; accent-color: var(--acid); }
  .upload-actions { display: flex; gap: 12px; }
  .steps { display: grid; grid-template-columns: repeat(3,1fr); border-top: 1px solid var(--line); }
  .steps article { padding: 28px 32px 0 0; }
  .steps article + article { padding-left: 32px; border-left: 1px solid var(--line); }
  .steps span { color: var(--acid); font: 700 10px/1 ui-monospace, monospace; }
  .steps h3 { font-size: 1.5rem; margin: 14px 0 10px; }
  .steps p { color: var(--muted); line-height: 1.6; }
  footer { min-height: 90px; gap: 20px; color: #747c81; border-top: 1px solid #25292d; font-size: .78rem; }
  footer span:last-child { text-align: right; }
  footer a { color: var(--acid); }
  @media (max-width: 760px) {
    .page-shell { width: min(100% - 28px, 620px); }
    header nav { display: none; }
    main { padding: 56px 0 72px; }
    .hero { grid-template-columns: 1fr; gap: 42px; padding-bottom: 60px; }
    section + section { margin-top: 76px; }
    .diagnostic-grid { grid-template-columns: repeat(2,1fr); }
    .image-intro { align-items: start; flex-direction: column; }
    .upload-bar { align-items: stretch; flex-direction: column; }
    .upload-actions { display: grid; grid-template-columns: 1fr 1fr; }
    .steps { grid-template-columns: 1fr; }
    .steps article, .steps article + article { padding: 24px 0; border-left: 0; border-bottom: 1px solid var(--line); }
  }
  @media (max-width: 430px) {
    .privacy { display: none; }
    .diagnostic-grid { grid-template-columns: 1fr; }
    .image-section { padding: 26px 18px; }
    .upload-actions { grid-template-columns: 1fr; }
    footer { flex-direction: column; justify-content: center; align-items: flex-start; }
    footer span:last-child { text-align: left; }
  }
</style>
