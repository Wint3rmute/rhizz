<script lang="ts">
  import { onMount } from "svelte";
  import { initWasm, compile } from "./lib/rhizz.ts";
  import { layoutSystem } from "./lib/layout.ts";
  import { createRenderer, type HoverInfo, type RendererState } from "./lib/renderer.ts";
  import { EXAMPLES } from "./lib/examples.ts";
  import type { CompileResult, Model } from "./lib/types.ts";
  import InfoPanel from "./components/InfoPanel.svelte";
  import DiagnosticsPanel from "./components/DiagnosticsPanel.svelte";
  import ExampleSelector from "./components/ExampleSelector.svelte";

  let selectedExample = $state(0);
  let compileResult: CompileResult | null = $state(null);
  let hoverInfo: HoverInfo | null = $state(null);
  let viewportEl: HTMLDivElement | undefined = $state();
  let rendererState: RendererState | null = $state(null);
  let ready = $state(false);
  let error: string | null = $state(null);

  onMount(async () => {
    try {
      await initWasm();
      ready = true;
      compileAndRender();
    } catch (e) {
      error = `Failed to load WASM: ${e}`;
    }
  });

  function compileAndRender() {
    if (!ready || !viewportEl) return;

    const example = EXAMPLES[selectedExample];
    const result = compile(example.sources);
    compileResult = result;

    // Clean up previous renderer
    if (rendererState) {
      rendererState.cleanup();
      rendererState = null;
    }

    if (!result.model || result.model.systems.length === 0) return;

    const layout = layoutSystem(result.model, 0);
    rendererState = createRenderer(viewportEl, layout, (info) => {
      hoverInfo = info;
    });
  }

  function selectExample(idx: number) {
    selectedExample = idx;
    compileAndRender();
  }

  function exportSVG() {
    if (!rendererState) return;
    const svg = rendererState.exportSVG();
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${EXAMPLES[selectedExample].name.toLowerCase().replace(/\s+/g, "-")}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="app">
  <header>
    <h1>rhizz</h1>
    <span class="subtitle">System Model Explorer</span>
    {#if rendererState}
      <button class="export-btn" onclick={exportSVG}>Export SVG</button>
    {/if}
  </header>

  <ExampleSelector
    examples={EXAMPLES}
    selected={selectedExample}
    onselect={selectExample}
  />

  <div class="viewport" bind:this={viewportEl}>
    {#if error}
      <div class="error-msg">{error}</div>
    {:else if !ready}
      <div class="loading">Loading WASM…</div>
    {/if}
  </div>

  <InfoPanel info={hoverInfo} />

  {#if compileResult}
    <DiagnosticsPanel diagnostics={compileResult.diagnostics} />
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    background: #0a0a14;
    color: #e0e0e0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    overflow: hidden;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    background: #12121e;
    border-bottom: 1px solid #333;
  }

  h1 {
    margin: 0;
    font-size: 20px;
    color: #82aaff;
    font-weight: 700;
  }

  .subtitle {
    color: #666;
    font-size: 13px;
  }

  .export-btn {
    margin-left: auto;
    background: #2a3a5a;
    color: #a0c4ff;
    border: 1px solid #4a6a9a;
    border-radius: 4px;
    padding: 5px 14px;
    cursor: pointer;
    font-size: 12px;
  }

  .export-btn:hover {
    background: #3a4a6a;
  }

  .viewport {
    flex: 1;
    position: relative;
    overflow: hidden;
    background: #0f0f1a;
  }

  .viewport :global(svg) {
    width: 100%;
    height: 100%;
  }

  .loading,
  .error-msg {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 16px;
    color: #666;
  }

  .error-msg {
    color: #ff6b6b;
  }
</style>
