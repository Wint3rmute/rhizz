<script lang="ts">
  import type { Diagnostic } from "../lib/types.ts";

  interface Props {
    diagnostics: Diagnostic[];
  }

  let { diagnostics }: Props = $props();

  function isError(d: Diagnostic): boolean {
    return d.code.startsWith("E");
  }
</script>

{#if diagnostics.length > 0}
  <div class="diagnostics">
    <h3>Diagnostics ({diagnostics.length})</h3>
    <ul>
      {#each diagnostics as d}
        <li class:error={isError(d)} class:warning={!isError(d)}>
          <span class="code">{d.code}</span>
          <span class="msg">{d.message}</span>
          {#if d.file}
            <span class="file">{d.file}{d.line != null ? `:${d.line}` : ""}</span>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .diagnostics {
    position: absolute;
    top: 16px;
    right: 16px;
    background: #1a1a2e;
    color: #e0e0e0;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 12px 16px;
    max-width: 400px;
    max-height: 300px;
    overflow-y: auto;
    font-size: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 10;
  }

  h3 {
    margin: 0 0 8px;
    font-size: 13px;
    color: #aaa;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    padding: 4px 0;
    border-bottom: 1px solid #2a2a3a;
    display: flex;
    gap: 8px;
    align-items: baseline;
  }

  .code {
    font-weight: 700;
    font-family: monospace;
  }

  .error .code {
    color: #ff6b6b;
  }

  .warning .code {
    color: #ffc857;
  }

  .msg {
    flex: 1;
  }

  .file {
    color: #666;
    font-size: 11px;
    font-family: monospace;
  }
</style>
