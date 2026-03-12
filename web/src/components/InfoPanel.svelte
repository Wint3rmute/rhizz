<script lang="ts">
  import type { HoverInfo } from "../lib/renderer.ts";

  interface Props {
    info: HoverInfo | null;
  }

  let { info }: Props = $props();
</script>

{#if info}
  <div class="info-panel">
    <h3>{info.label}</h3>
    {#if info.description}
      <p class="desc">{info.description}</p>
    {/if}
    {#if info.tags.length > 0}
      <div class="tags">
        {#each info.tags as tag}
          <span class="tag">{tag}</span>
        {/each}
      </div>
    {/if}
    {#if info.kind === "node" && info.ports.length > 0}
      <div class="ports">
        <h4>Ports</h4>
        {#each info.ports as port}
          <div class="port">
            <span class="port-label">{port.label}</span>
            <span class="port-protocol">{port.protocol}</span>
            <span class="port-role {port.role.toLowerCase()}">{port.role.toLowerCase()}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .info-panel {
    position: absolute;
    bottom: 16px;
    left: 16px;
    background: #1a1a2e;
    color: #e0e0e0;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 16px;
    min-width: 240px;
    max-width: 360px;
    font-size: 13px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 10;
  }

  h3 {
    margin: 0 0 6px;
    font-size: 15px;
    color: #82aaff;
  }

  h4 {
    margin: 10px 0 4px;
    font-size: 12px;
    text-transform: uppercase;
    color: #777;
  }

  .desc {
    margin: 0 0 8px;
    color: #bbb;
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }

  .tag {
    background: #2a2a4a;
    color: #a0c4ff;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
  }

  .port {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 3px 0;
    border-bottom: 1px solid #2a2a3a;
  }

  .port-label {
    font-weight: 600;
    color: #c0d0e0;
  }

  .port-protocol {
    color: #888;
    font-size: 11px;
  }

  .port-role {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    text-transform: uppercase;
  }

  .port-role.provider {
    background: #1b4332;
    color: #95d5b2;
  }

  .port-role.consumer {
    background: #3d1f00;
    color: #ffb347;
  }

  .port-role.peer {
    background: #1a1a3e;
    color: #a0a0ff;
  }
</style>
