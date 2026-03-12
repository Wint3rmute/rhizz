<script lang="ts">
  import type { Example } from "../lib/examples.ts";

  interface Props {
    examples: Example[];
    selected: number;
    onselect: (idx: number) => void;
  }

  let { examples, selected, onselect }: Props = $props();
</script>

<div class="selector">
  {#each examples as ex, i}
    <button
      class:active={selected === i}
      onclick={() => onselect(i)}
    >
      <span class="name">{ex.name}</span>
      <span class="desc">{ex.description}</span>
    </button>
  {/each}
</div>

<style>
  .selector {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    background: #12121e;
    border-bottom: 1px solid #333;
  }

  button {
    background: #1a1a2e;
    color: #ccc;
    border: 1px solid #333;
    border-radius: 6px;
    padding: 8px 16px;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s;
  }

  button:hover {
    background: #2a2a4a;
  }

  button.active {
    background: #2a3a5a;
    border-color: #4a90d9;
    color: #fff;
  }

  .name {
    display: block;
    font-weight: 600;
    font-size: 14px;
  }

  .desc {
    display: block;
    font-size: 11px;
    color: #888;
    margin-top: 2px;
  }
</style>
