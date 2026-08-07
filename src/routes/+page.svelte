<svelte:head>
  <title>DC34 Companion</title>
  <meta
    name="description"
    content="A browser-based companion for the DEF CON 34 badge."
  />
</svelte:head>

<script lang="ts">
  const diagnostics = [
    { label: 'Connection', value: 'Not connected', tone: 'idle' },
    { label: 'Firmware', value: '—', tone: 'idle' },
    { label: 'Temperature', value: '—', tone: 'idle' },
    { label: 'Memory', value: '—', tone: 'idle' }
  ];
</script>

<div class="page-shell">
  <header>
    <a class="brand" href="/" aria-label="DC34 Companion home">
      <span class="mark">34</span>
      <span>DC34 Companion</span>
    </a>
    <span class="prototype">Prototype</span>
  </header>

  <main>
    <section class="hero">
      <div>
        <p class="eyebrow">YOUR BADGE, YOUR CANVAS</p>
        <h1>Meet your badge<br />on its own terms.</h1>
        <p class="lede">
          Inspect your DC34 badge, prepare custom display art, and explore its built-in tools—right
          from a compatible browser.
        </p>
      </div>

      <div class="connect-card">
        <div class="connection-state">
          <span class="pulse"></span>
          <div>
            <strong>No badge connected</strong>
            <small>Connect your badge over USB to begin.</small>
          </div>
        </div>
        <button type="button" disabled>Connect badge <span aria-hidden="true">→</span></button>
        <p>Web Serial support is coming in the next build.</p>
      </div>
    </section>

    <section aria-labelledby="diagnostics-heading">
      <div class="section-heading">
        <div>
          <p class="eyebrow">AT A GLANCE</p>
          <h2 id="diagnostics-heading">Diagnostics</h2>
        </div>
        <span>Waiting for badge</span>
      </div>

      <div class="diagnostic-grid">
        {#each diagnostics as diagnostic}
          <article>
            <span>{diagnostic.label}</span>
            <strong>{diagnostic.value}</strong>
          </article>
        {/each}
      </div>
    </section>

    <section class="image-workshop" aria-labelledby="image-heading">
      <div class="image-copy">
        <p class="eyebrow">DISPLAY WORKSHOP</p>
        <h2 id="image-heading">Turn anything into badge art.</h2>
        <p>
          Crop, resize, and dither an image into the crisp 128 × 128 monochrome format the badge
          understands. Preview every pixel before uploading.
        </p>
        <button type="button" disabled>Choose an image</button>
      </div>
      <div class="display-preview" aria-label="Placeholder badge display preview">
        <div class="screen">
          <span>128 × 128</span>
          <div class="pixel-mark">DC<br />34</div>
        </div>
        <small>PREVIEW</small>
      </div>
    </section>
  </main>

  <footer>
    <span>Built for curious humans at DEF CON 34.</span>
    <a href="https://github.com/spadaval/dc34-companion">Source</a>
  </footer>
</div>

<style>
  :global(*) { box-sizing: border-box; }
  :global(html) { color-scheme: dark; background: #090b0d; }
  :global(body) {
    margin: 0;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #f3f4ee;
    background:
      radial-gradient(circle at 82% 3%, rgba(189, 255, 63, 0.08), transparent 27rem),
      #090b0d;
  }
  :global(button), :global(a) { font: inherit; }
  .page-shell { width: min(1160px, calc(100% - 40px)); margin: 0 auto; min-height: 100vh; }
  header, footer { display: flex; align-items: center; justify-content: space-between; }
  header { min-height: 84px; border-bottom: 1px solid #25292d; }
  .brand { display: flex; gap: 12px; align-items: center; color: inherit; text-decoration: none; font-weight: 750; letter-spacing: -0.02em; }
  .mark { display: grid; place-items: center; width: 34px; aspect-ratio: 1; color: #090b0d; background: #c7ff45; font: 900 14px/1 ui-monospace, monospace; transform: rotate(-3deg); }
  .prototype, .section-heading > span { color: #8c949a; font: 650 11px/1 ui-monospace, monospace; text-transform: uppercase; letter-spacing: .13em; }
  main { padding: 80px 0 100px; }
  .hero { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(310px, .65fr); gap: 70px; align-items: end; padding-bottom: 96px; }
  .eyebrow { margin: 0 0 18px; color: #c7ff45; font: 750 11px/1 ui-monospace, monospace; letter-spacing: .16em; }
  h1, h2 { margin: 0; letter-spacing: -.055em; line-height: .98; }
  h1 { max-width: 760px; font-size: clamp(3.2rem, 8vw, 6.9rem); }
  h2 { font-size: clamp(2rem, 4.5vw, 3.7rem); }
  .lede { max-width: 620px; margin: 30px 0 0; color: #abb1b5; font-size: clamp(1rem, 2vw, 1.2rem); line-height: 1.65; }
  .connect-card { padding: 24px; border: 1px solid #2d3337; background: rgba(17, 20, 22, .9); box-shadow: 0 18px 60px rgba(0,0,0,.28); }
  .connection-state { display: flex; gap: 14px; align-items: center; }
  .pulse { width: 9px; aspect-ratio: 1; border-radius: 50%; background: #596067; box-shadow: 0 0 0 5px rgba(89,96,103,.12); }
  .connection-state div { display: grid; gap: 5px; }
  .connection-state small, .connect-card p { color: #858d92; }
  button { min-height: 48px; border: 0; padding: 0 18px; font-weight: 800; background: #c7ff45; color: #0b0d0e; }
  button:disabled { cursor: not-allowed; opacity: .45; }
  .connect-card button { width: 100%; display: flex; justify-content: space-between; align-items: center; margin-top: 26px; }
  .connect-card p { margin: 13px 0 0; font-size: .76rem; text-align: center; }
  section + section { margin-top: 92px; }
  .section-heading { display: flex; align-items: end; justify-content: space-between; margin-bottom: 28px; }
  .diagnostic-grid { display: grid; grid-template-columns: repeat(4, 1fr); border: solid #292e32; border-width: 1px 0 0 1px; }
  .diagnostic-grid article { min-height: 132px; display: flex; flex-direction: column; justify-content: space-between; padding: 20px; border: solid #292e32; border-width: 0 1px 1px 0; }
  .diagnostic-grid span { color: #7f888e; font: 650 11px/1 ui-monospace, monospace; text-transform: uppercase; letter-spacing: .1em; }
  .diagnostic-grid strong { font-size: 1.1rem; }
  .image-workshop { display: grid; grid-template-columns: 1fr 1fr; align-items: center; min-height: 500px; padding: clamp(32px, 7vw, 76px); background: #111416; border: 1px solid #292e32; overflow: hidden; }
  .image-copy { max-width: 500px; }
  .image-copy > p:not(.eyebrow) { color: #9ba2a7; line-height: 1.7; margin: 26px 0; }
  .display-preview { justify-self: center; text-align: center; transform: rotate(2deg); }
  .screen { display: grid; place-items: center; width: min(280px, 55vw); aspect-ratio: 1; padding: 16px; color: #101310; background: #cbd5b5; border: 14px solid #24292b; box-shadow: 16px 18px 0 #070809; }
  .screen > span { align-self: start; justify-self: start; font: 700 9px/1 ui-monospace, monospace; opacity: .55; }
  .pixel-mark { align-self: center; font: 950 clamp(3.8rem, 9vw, 7rem)/.72 ui-monospace, monospace; letter-spacing: -.12em; }
  .display-preview small { display: inline-block; margin-top: 30px; color: #777f84; font: 700 10px/1 ui-monospace, monospace; letter-spacing: .18em; }
  footer { min-height: 90px; color: #747c81; border-top: 1px solid #25292d; font-size: .85rem; }
  footer a { color: #c7ff45; }
  @media (max-width: 760px) {
    .page-shell { width: min(100% - 28px, 600px); }
    main { padding: 56px 0 72px; }
    .hero { grid-template-columns: 1fr; gap: 42px; padding-bottom: 72px; }
    .diagnostic-grid { grid-template-columns: repeat(2, 1fr); }
    .image-workshop { grid-template-columns: 1fr; gap: 50px; padding: 30px 22px 48px; }
    .display-preview { grid-row: 1; }
    .section-heading > span { display: none; }
  }
  @media (max-width: 390px) {
    .prototype { display: none; }
    .diagnostic-grid { grid-template-columns: 1fr; }
    footer { align-items: flex-start; flex-direction: column; justify-content: center; gap: 10px; }
  }
</style>
