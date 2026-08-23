<script lang="ts">
import type { TextAlign } from "./geometry";
import type { ComponentData, PortData } from "../../../../DocumentStore.svelte";

interface Props {
  componentKey: string;
  component: ComponentData;
  textAlign: TextAlign;
  onupdate: (patch: Partial<ComponentData>) => void;
  onrename: (newLabel: string) => void;
  onsettextalign: (align: TextAlign) => void;
  ondelete?: () => void;
}

let {
  componentKey,
  component,
  textAlign,
  onupdate,
  onrename,
  onsettextalign,
  ondelete,
}: Props = $props();

let editLabel = $state("");
let editDescription = $state("");
let editTagsStr = $state("");
let editLeaf = $state(false);

$effect(() => {
  editLabel = component.label;
  editDescription = component.description || "";
  editTagsStr = (component.tags || []).join(", ");
  editLeaf = component.leaf;
});

function handleLabelBlur() {
  const trimmed = editLabel.trim();
  if (trimmed && trimmed !== component.label) {
    onrename(trimmed);
  } else {
    editLabel = component.label;
  }
}

function handleDescriptionBlur() {
  if (editDescription !== (component.description || "")) {
    onupdate({ description: editDescription });
  }
}

function handleTagsBlur() {
  const tags = editTagsStr
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  onupdate({ tags });
}

function handleLeafChange(e: Event) {
  const checked = (e.target as HTMLInputElement).checked;
  editLeaf = checked;
  onupdate({ leaf: checked });
}

// ── Port Operations ───────────────────────────────────────────────────────────

function handleAddPort() {
  const portName = prompt("Port name?", `port-${component.ports.length + 1}`)
    ?.trim();
  if (!portName) return;
  const newPorts = [
    ...component.ports,
    {
      label: portName,
      description: "",
      protocol: "data",
      role: "peer" as const,
      tags: [],
      messages: [],
    },
  ];
  onupdate({ ports: newPorts });
}

function handleDeletePort(portIdx: number) {
  const newPorts = component.ports.filter((_, i) => i !== portIdx);
  onupdate({ ports: newPorts });
}

function handleUpdatePort(portIdx: number, patch: Partial<PortData>) {
  const newPorts = component.ports.map((p, i) =>
    i === portIdx ? { ...p, ...patch } : p
  );
  onupdate({ ports: newPorts });
}
</script>

<div class="space-y-4 text-sm" data-testid="node-inspector">
  <!-- Component Info -->
  <div class="space-y-2">
    <div class="text-[11px] text-base-content/50 font-mono truncate"
      title={componentKey}>
      {componentKey}
    </div>
    <div class="form-control">
      <label class="label py-1" for="comp-name-input">
        <span
          class="label-text text-xs font-semibold uppercase tracking-wider text-base-content/70">
          Component Name
        </span>
      </label>
      <input
        id="comp-name-input"
        type="text"
        bind:value={editLabel}
        onblur={handleLabelBlur}
        class="input input-sm input-bordered w-full font-medium"
      />
    </div>

    <div class="form-control">
      <label class="label py-1" for="comp-desc-input">
        <span
          class="label-text text-xs font-semibold uppercase tracking-wider text-base-content/70">
          Description
        </span>
      </label>
      <textarea
        id="comp-desc-input"
        bind:value={editDescription}
        onblur={handleDescriptionBlur}
        class="textarea textarea-sm textarea-bordered w-full resize-y h-16"
        placeholder="Human-readable description..."
      ></textarea>
    </div>

    <div class="form-control">
      <label class="label py-1" for="comp-tags-input">
        <span
          class="label-text text-xs font-semibold uppercase tracking-wider text-base-content/70">
          Tags (comma-separated)
        </span>
      </label>
      <input
        id="comp-tags-input"
        type="text"
        bind:value={editTagsStr}
        onblur={handleTagsBlur}
        class="input input-sm input-bordered w-full"
        placeholder="e.g. sensor, power, compute"
      />
    </div>

    <div class="form-control">
      <label class="label cursor-pointer justify-start gap-2 py-1">
        <input
          type="checkbox"
          checked={editLeaf}
          onchange={handleLeafChange}
          class="checkbox checkbox-xs checkbox-primary"
        />
        <span
          class="label-text font-medium">Atomic Leaf (no sub-components)</span>
      </label>
    </div>

    <div class="space-y-1 pt-1">
      <span
        class="text-xs font-semibold uppercase tracking-wider text-base-content/70">
        Text alignment
      </span>
      <div class="join w-full">
        <button
          class="btn btn-xs join-item flex-1 {textAlign === 'center'
            ? 'btn-primary'
            : 'btn-ghost'}"
          onclick={() => onsettextalign("center")}
        >
          Center
        </button>
        <button
          class="btn btn-xs join-item flex-1 {textAlign === 'top-center'
            ? 'btn-primary'
            : 'btn-ghost'}"
          onclick={() => onsettextalign("top-center")}
        >
          Top
        </button>
        <button
          class="btn btn-xs join-item flex-1 {textAlign === 'top-left'
            ? 'btn-primary'
            : 'btn-ghost'}"
          onclick={() => onsettextalign("top-left")}
        >
          Top-left
        </button>
      </div>
    </div>
  </div>

  <div class="divider my-2"></div>

  <!-- Ports Section -->
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <span class="text-xs font-semibold uppercase tracking-wider text-base-content/70">
        Ports ({component.ports.length})
      </span>
      <button
        onclick={handleAddPort}
        class="btn btn-xs btn-outline btn-primary"
        title="Add a new typed port"
      >
        + Add Port
      </button>
    </div>

    {#if component.ports.length === 0}
      <p class="text-xs text-base-content/50 italic">
        No ports declared yet. Add a port to specify protocols and message schemas.
      </p>
    {:else}
      <div class="space-y-3">
        {#each component.ports as port, portIdx (portIdx)}
          <div class="card bg-base-200 border border-base-300 p-3 space-y-2 rounded-box">
            <div class="flex items-center justify-between gap-2">
              <input
                type="text"
                value={port.label}
                onchange={(e) =>
                  handleUpdatePort(portIdx, {
                    label: (e.target as HTMLInputElement).value.trim(),
                  })}
                class="input input-xs input-bordered font-semibold flex-1"
                placeholder="Port name"
              />
              <button
                onclick={() => handleDeletePort(portIdx)}
                class="btn btn-xs btn-ghost btn-square text-error"
                title="Delete port"
              >
                ✕
              </button>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <div class="form-control">
                <span class="text-[10px] uppercase font-semibold text-base-content/60">Protocol</span>
                <input
                  type="text"
                  value={port.protocol || ""}
                  onchange={(e) =>
                    handleUpdatePort(portIdx, {
                      protocol: (e.target as HTMLInputElement).value.trim(),
                    })}
                  class="input input-xs input-bordered"
                  placeholder="e.g. spi, http"
                />
              </div>
              <div class="form-control">
                <span class="text-[10px] uppercase font-semibold text-base-content/60">Role</span>
                <select
                  value={port.role || "peer"}
                  onchange={(e) =>
                    handleUpdatePort(portIdx, {
                      role: (e.target as HTMLSelectElement).value as "provider" | "consumer" | "peer",
                    })}
                  class="select select-xs select-bordered"
                >
                  <option value="provider">Provider</option>
                  <option value="consumer">Consumer</option>
                  <option value="peer">Peer</option>
                </select>
              </div>
            </div>

            <div class="flex items-center gap-4 pt-1">
              <label class="label cursor-pointer justify-start gap-1.5 p-0">
                <input
                  type="checkbox"
                  checked={Boolean(port.external)}
                  onchange={(e) =>
                    handleUpdatePort(portIdx, {
                      external: (e.target as HTMLInputElement).checked,
                    })}
                  class="checkbox checkbox-xs checkbox-primary"
                />
                <span class="label-text text-xs">External (Boundary)</span>
              </label>

              <label class="label cursor-pointer justify-start gap-1.5 p-0">
                <input
                  type="checkbox"
                  checked={port.required !== false}
                  onchange={(e) =>
                    handleUpdatePort(portIdx, {
                      required: (e.target as HTMLInputElement).checked,
                    })}
                  class="checkbox checkbox-xs"
                />
                <span class="label-text text-xs">Required</span>
              </label>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  {#if ondelete}
    <div class="divider my-2"></div>
    <button
      onclick={() => {
        if (
          confirm(
            `Delete component "${component.label}"? This will remove it from the system model.`,
          )
        ) {
          ondelete();
        }
      }}
      class="btn btn-xs btn-outline btn-error w-full"
      title="Delete this component from the system model"
    >
      Delete Component
    </button>
  {/if}
</div>
