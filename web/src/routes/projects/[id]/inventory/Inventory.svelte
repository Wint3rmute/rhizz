<script lang="ts">
  // Inventory Browser: lists every component *definition* (never instances)
  // in the compiled model, with a read-only preview of the definition's
  // default diagram (`views/<label>.hcl`) and a tabbed detail pane.
  //
  // Data is taken from the compiled model's raw payload (`model.to_js()`),
  // which — unlike the typed wasm wrappers — exposes children/ports/parent
  // indices needed to reconstruct definition trees and hierarchy paths.
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { untrack } from "svelte";
  import {
    applyModelMutation,
    type ModelMutationOp,
  } from "../../../../history/applyMutation";
  import type {
    ComponentPatch,
    ProtocolPatch,
    SystemPatch,
  } from "../../../../actionLog";
  import {
    componentDataByKey,
    connectionDataList,
    type PortData,
    type ProtocolData,
    protocolDataList,
    protocolMessages,
    protocolUsage,
  } from "../../../../modelView";
  import { toastState } from "../../../../ToastState.svelte";
  import { getProjectModel } from "../../../../ProjectModel.svelte";
  import { projectStore } from "../../../../ProjectState.svelte";
  import { primaryHclPath } from "../../../../vfs/compile";
  import { openProjectFs } from "../../../../vfs/fs";
  import { TOUR_TARGETS } from "../../../../tour/tourTargets";
  import DiagramViewer from "../modeling/DiagramViewer.svelte";
  import CreateComponentModal from "../modeling/CreateComponentModal.svelte";
  import CreateSystemModal from "../modeling/CreateSystemModal.svelte";
  import {
    emptyDiagramLayout,
    parse_views,
    VIEW_LAYOUT_DIR,
    writeDiagramLayoutFile,
  } from "../modeling/persistence";
  import CreateProtocolModal from "./CreateProtocolModal.svelte";
  import DefinitionCard from "./DefinitionCard.svelte";
  import DetailPane from "./DetailPane.svelte";
  import ProtocolCard from "./ProtocolCard.svelte";
  import ProtocolDetailPane from "./ProtocolDetailPane.svelte";
  import { inventoryProtocolHref } from "./protocolLink";
  import Pane from "../../../../components/modular_ui/Pane.svelte";
  import Splitter from "../../../../components/modular_ui/Splitter.svelte";
  import {
    SIDE_PANEL_WIDTH_FRACTION,
    viewportCap,
  } from "../../../../components/modular_ui/viewport";
  import { inventoryPanes } from "./panes";
  import {
    defaultViewPath,
    definitionLabelForNode,
    filterDefinitions,
    filterProtocols,
    filterSystems,
    filterWithViews,
    hasDefaultView,
    instancePathsForDefinition,
    INVENTORY_TABS,
    type InventoryDefinition,
    type InventorySystem,
    InventoryTab,
    preferredViewSystem,
    systemAsDefinition,
    viewsBoundToSystem,
  } from "./inventory";

  let {
    projectId = null,
    requestedLabel = "",
  }: {
    projectId?: string | null;
    /** The entity named by the route path ("" = none requested). */
    requestedLabel?: string;
  } = $props();

  // ── Model state (shared with the status bar and the other pages) ───────────
  const projectModel = getProjectModel();
  let model = $derived(projectModel.model);
  let raw = $derived(projectModel.raw);
  // Whether the model has been read (or found unreadable) — see `modelReady`
  // under the URL section below, which waits for this before resolving the URL.
  let modelReady = $derived(projectModel.ready);
  let comps = $derived(raw?.components ?? []);
  let rawPorts = $derived(raw?.ports ?? []);

  // ── Definitions extracted from the compiled model ──────────────────────────
  // `raw.definitions` holds the arena indices of the top-level reusable
  // definitions (retained even with zero instances). Instances are never
  // listed — only these definition subtrees.
  let definitions = $derived.by<InventoryDefinition[]>(() => {
    const list: InventoryDefinition[] = [];
    for (const cid of raw?.definitions ?? []) {
      const build = (index: number): InventoryDefinition => {
        const c = comps[index];
        if (!c) {
          return {
            label: `#${index}`,
            full_name: "",
            tags: [],
            level: 1,
            leaf: false,
            children: [],
            ports: [],
          };
        }
        return {
          label: c.label,
          full_name: c.full_name ?? "",
          tags: c.tags ?? [],
          level: c.level ?? 1,
          leaf: c.leaf ?? false,
          icon: c.icon,
          color: c.color,
          border: c.border,
          font: c.font,
          children: (c.children ?? []).map((child: number) => build(child)),
          ports: (c.ports ?? []).map((pid: number) => {
            const p = rawPorts[pid];
            return {
              label: p?.label ?? `#${pid}`,
              protocol: p?.protocol ?? "",
              role: p?.role ?? "peer",
              external: p?.external ?? false,
              required: p?.required ?? true,
              full_name: p?.full_name ?? "",
            };
          }),
        };
      };
      list.push(build(cid));
    }
    return list;
  });

  // ── Sidebar state ───────────────────────────────────────────────────────────
  let activeTab = $state<InventoryTab>(InventoryTab.Components);
  let query = $state("");
  let selectedLabel = $state<string | null>(null);
  // The open protocol while the Protocols tab shows. Mirrored in the URL's
  // query string, see the protocol section below.
  let selectedProtocol = $state<string | null>(null);

  // ── Modular workspace layout ────────────────────────────────────────────────
  // Panel widths + hidden flags in one serializable store, persisted across
  // reloads. Resizes clamp via the store; hide/restore preserve widths so a
  // restored panel comes back exactly as it was.
  let layout = $state(inventoryPanes.read());

  $effect(() => {
    inventoryPanes.write(layout);
  });

  // Systems come straight from the compiled payload (`raw.systems`), in model
  // order — the same source `model.systems()` reads, but with full_name/icon/
  // tags for search and cards.
  let systems = $derived.by<InventorySystem[]>(() =>
    (raw?.systems ?? []).map((s) => ({
      label: s.label,
      full_name: s.full_name ?? "",
      icon: s.icon,
      tags: s.tags ?? [],
    })),
  );

  // ── Protocols ───────────────────────────────────────────────────────────────
  let protocols = $derived<ProtocolData[]>(protocolDataList(model));
  let componentsByKey = $derived(componentDataByKey(model));
  let allConnections = $derived(connectionDataList(model));
  // How many ports name each protocol, for the list cards. protocolUsage skips
  // instances, so each port is counted once.
  let protocolPortCounts = $derived(
    new Map<string, number>(
      protocols.map((p): [string, number] => [
        p.label,
        protocolUsage(p.label, componentsByKey, protocols, allConnections).ports
          .length,
      ]),
    ),
  );
  let filteredProtocols = $derived(filterProtocols(protocols, query));
  let openProtocol = $derived(
    protocols.find((p) => p.label === selectedProtocol) ?? null,
  );
  let openProtocolUsage = $derived(
    openProtocol === null
      ? null
      : protocolUsage(
          openProtocol.label,
          componentsByKey,
          protocols,
          allConnections,
        ),
  );
  let openProtocolMessages = $derived(
    openProtocol === null ? [] : protocolMessages(model, openProtocol.label),
  );

  let onlyWithViews = $state(false);

  let filtered = $derived(
    filterWithViews(
      filterDefinitions(definitions, { tab: activeTab, query }),
      onlyWithViews,
      (d) => hasDefaultView(projectModel.sources, d.label),
    ),
  );

  let filteredSystems = $derived(
    filterWithViews(filterSystems(systems, query), onlyWithViews, (s) =>
      boundViews.some((v) => v.system === s.label),
    ),
  );

  // The rows the sidebar actually shows for the active tab.
  let visibleLabels = $derived(
    activeTab === InventoryTab.Protocols
      ? []
      : activeTab === InventoryTab.Systems
        ? filteredSystems.map((s) => s.label)
        : filtered.map((d) => d.label),
  );

  // ── The inspected entity lives in the URL path ─────────────────────────────
  //
  // `/projects/<id>/inventory/<label>`, so the address bar always names what the
  // detail pane shows: it can be shared, bookmarked, and the browser's
  // back/forward buttons move between entities. `selectedLabel` stays the source
  // of truth for rendering and the URL mirrors it in both directions — clicks go
  // through selectLabel, the URL is only ever *adopted* (see the effect below),
  // so the two can never fight. Same shape as Modeling's open view.
  function labelUrl(label: string | null): string {
    return resolve("/projects/[id]/inventory/[...label]", {
      id: projectId ?? "",
      label: label ?? "",
    });
  }

  // Opens `label` (or nothing, for the bare page) and makes the URL name it.
  // `replace` rewrites the current history entry instead of pushing a new one —
  // used when the URL is being canonicalised (a bare page, a search that hides
  // the open entity) rather than moved to by the user.
  function selectLabel(label: string | null, replace = false): void {
    selectedLabel = label;
    navigateTo(labelUrl(label), replace);
  }

  // Moves to `url` unless the address bar already shows it. The query counts:
  // the Protocols tab is `?tab=protocols` on the same path an entity uses.
  function navigateTo(url: string, replace = false): void {
    if (url === page.url.pathname + page.url.search) return;
    void goto(url, { replace, reset: false });
  }

  // The last entity this page settled on. Non-reactive: it exists so a
  // navigation this page performed itself (selectLabel writes the state first,
  // the URL a tick later) is not mistaken for the user pressing back, which
  // would undo the very click that caused it.
  let lastHandledLabel: string | null = null;

  // The Protocols tab is addressed by query (`?tab=protocols[&protocol=…]`),
  // so the URL decides whether it is open. This effect is declared before the
  // entity effect below, so a cold protocol link settles the tab first. Reads
  // of the tab and the open protocol are untracked: a click writes them before
  // the URL catches up, and reacting to that lag would undo the click.
  $effect(() => {
    if (!modelReady) return;
    if (page.url.searchParams.get("tab") !== InventoryTab.Protocols) return;
    if (untrack(() => activeTab) !== InventoryTab.Protocols) {
      activeTab = InventoryTab.Protocols;
    }
    const requested = page.url.searchParams.get("protocol");
    const open =
      requested !== null && protocols.some((p) => p.label === requested)
        ? requested
        : null;
    if (open !== untrack(() => selectedProtocol)) selectedProtocol = open;
  });

  $effect(() => {
    // Before the model is read there is nothing to resolve the path against —
    // and a cold deep link would be rewritten to the bare page if we tried.
    if (!modelReady) return;
    // The Protocols URL names no entity, so there is nothing to resolve here.
    // Keep the bookkeeping cleared so leaving the tab resolves afresh.
    if (page.url.searchParams.get("tab") === InventoryTab.Protocols) {
      lastHandledLabel = null;
      return;
    }
    const requested = requestedLabel;
    // Already settled — this is our own navigation echoing back (or a filter
    // change re-running the effect), not a new entity to open.
    if (requested === lastHandledLabel) return;
    lastHandledLabel = requested;
    // A new path names an entity, so it ends the Protocols tab.
    if (activeTab === InventoryTab.Protocols) {
      activeTab = InventoryTab.Components;
    }
    const isOpenable =
      requested !== "" &&
      (definitions.some((d) => d.label === requested) ||
        systems.some((s) => s.label === requested));
    if (isOpenable) {
      selectedLabel = requested;
      // Keep the tab on the kind that holds the deep-linked entity, so the
      // sidebar shows the open row instead of falling back elsewhere.
      if (systems.some((s) => s.label === requested)) {
        activeTab = InventoryTab.Systems;
      } else if (definitions.some((d) => d.label === requested)) {
        activeTab = InventoryTab.Components;
      }
      return;
    }
    // Nothing openable in the path — a bare page, or an entity that has since
    // been renamed or deleted. The open entity has to be one the current filter
    // still shows, so fall back to the first match and take the URL with it:
    // the address bar must keep naming what the detail pane is showing.
    if (visibleLabels.length === 0) {
      if (selectedLabel !== null) selectLabel(null, true);
      return;
    }
    if (selectedLabel !== null && visibleLabels.includes(selectedLabel)) return;
    selectLabel(visibleLabels[0] ?? null, true);
  });

  let selectedDefinition = $derived.by<InventoryDefinition | null>(() => {
    const fromComponents = filtered.find((d) => d.label === selectedLabel);
    if (fromComponents) return fromComponents;
    // Systems reuse the definition card/preview/pane via a synthetic
    // definition — the diagram convention is the same (`views/<label>.hcl`).
    const sys = filteredSystems.find((s) => s.label === selectedLabel);
    if (sys) return systemAsDefinition(sys);
    // The selection may be hidden by the current tab's filter (e.g. a
    // deep link resolved before the tab switch, or a click that cleared it)
    // — still show it rather than a blank pane.
    const anyDef = definitions.find((d) => d.label === selectedLabel);
    if (anyDef) return anyDef;
    const anySys = systems.find((s) => s.label === selectedLabel);
    return anySys ? systemAsDefinition(anySys) : null;
  });

  // Whether the open entity is a system (rather than a component definition).
  // Decides what `handleCreateView` binds the new view to: a system binds to
  // itself, a definition binds to the system that instantiates it.
  let selectedIsSystem = $derived(
    selectedLabel !== null && systems.some((s) => s.label === selectedLabel),
  );

  // ── Clicking a node in the preview focuses the inventory on it ──────────────
  //
  // A node in the preview is a component the user can point at, so clicking it
  // does what clicking its card does — `selectLabel`, and therefore the same URL
  // change and the same back/forward. Explore's node click is the same idea one
  // page over. What a click *means* is decided here because it is this list's
  // question; see definitionLabelForNode.
  let definitionLabels = $derived(definitions.map((d) => d.label));

  function handleSelectNode(index: number): void {
    const label = definitionLabelForNode(raw, definitionLabels, index);
    // Nothing to focus, and saying so would be noise on a canvas that is only a
    // preview.
    if (label === null) return;
    // This list's own rule is that the open entity is one the current filter
    // still shows, and the URL effect below would enforce it by falling back to
    // the first row — undoing the click. Clear the filter instead, so the click
    // lands on the component that was pointed at.
    if (!visibleLabels.includes(label)) {
      query = "";
      activeTab = InventoryTab.Components;
    }
    selectLabel(label);
  }

  let emptyStatePath = $derived(
    selectedDefinition ? defaultViewPath(selectedDefinition.label) : null,
  );

  // Creates the missing component-specific view (`views/<label>.hcl`, bound
  // ── Documentation loading ───────────────────────────────────────────────────
  // The selected definition's doc is the VFS file `docs/<label>.md` (same
  // convention as Modeling's "Open documentation"). `selectedDoc` holds the
  // file content, or null when the file is missing; `selectedDocLabel` guards
  // against flashing the previous definition's doc while the new one loads.
  let selectedDoc = $state<string | null>(null);
  let selectedDocLabel = $state<string | null>(null);

  $effect(() => {
    const id = projectId;
    const label = selectedDefinition?.label;
    if (!id || !label) {
      selectedDoc = null;
      selectedDocLabel = label ?? null;
      return;
    }
    let cancelled = false;
    const fs = openProjectFs(projectStore, id);
    fs.readFile(`docs/${label}.md`)
      .then((content) => {
        if (cancelled) return;
        selectedDoc = content;
        selectedDocLabel = label;
      })
      .catch(() => {
        if (cancelled) return;
        selectedDoc = null;
        selectedDocLabel = label;
      });
    return () => {
      cancelled = true;
    };
  });

  // undefined while the newly-selected definition's doc is still loading.
  let docContent = $derived(
    selectedDocLabel === selectedDefinition?.label ? selectedDoc : undefined,
  );

  async function handleSaveDoc(label: string, content: string): Promise<void> {
    const id = projectId;
    if (!id) return;
    const fs = openProjectFs(projectStore, id);
    await fs.mkdir("docs", { recursive: true });
    await fs.writeFile(`docs/${label}.md`, content);
    // A debounced write can land after an entity switch: only refresh the
    // viewer state when its entity is still selected, otherwise the new
    // selection would flash "Loading…" until its own load lands. Reopening
    // the written entity reads the file fresh anyway.
    if (selectedDefinition?.label !== label) return;
    selectedDoc = content;
    selectedDocLabel = label;
  }

  // Creates a new system or component definition from the sidebar button
  // (above the search box). Both kinds go through a creation modal: systems
  // through a name-only `CreateSystemModal`, components through the shared
  // `CreateComponentModal` locked to "New Component Definition" (no instance
  // placement from here — this page only adds top-level definitions). A blank,
  // slash-containing or already-taken name is a silent no-op. On success the
  // list refreshes from disk and the new entity is selected.
  let creatingEntity = $state(false);
  let isCreateModalOpen = $state(false);
  let isCreateSystemModalOpen = $state(false);
  let isCreateProtocolModalOpen = $state(false);

  // Parents the modal's inspector shows alongside the new definition's key.
  // Nothing is ever placed under them from here — the modal needs the list,
  // and the systems are the only containers this page knows.
  let modalParents = $derived(
    systems.map((s) => ({
      key: s.label,
      label: s.label,
      isSystem: true,
      path: s.label,
    })),
  );

  async function handleAddEntity(): Promise<void> {
    const id = projectId;
    if (!id || creatingEntity) return;
    if (activeTab === InventoryTab.Protocols) {
      isCreateProtocolModalOpen = true;
      return;
    }
    if (activeTab === InventoryTab.Systems) {
      isCreateSystemModalOpen = true;
      return;
    }
    isCreateModalOpen = true;
  }

  async function handleSystemCreate(label: string): Promise<void> {
    isCreateSystemModalOpen = false;
    const id = projectId;
    if (!id || creatingEntity) return;
    const trimmed = label.trim();
    if (trimmed === "" || trimmed.includes("/")) return;
    // The system is already there — open it rather than writing a no-op.
    if (systems.some((s) => s.label === trimmed)) {
      selectLabel(trimmed);
      return;
    }
    creatingEntity = true;
    try {
      const fs = openProjectFs(projectStore, id);
      const targetPath = primaryHclPath(
        await fs.readdir(".", { recursive: true }),
      );
      const content = await fs.readFile(targetPath).catch(() => "");
      const result = await applyModelMutation(fs, targetPath, content, {
        kind: "add_system",
        label: trimmed,
      });
      if (!result.applied) return;
      await projectModel.reload();
      selectLabel(trimmed);
    } catch (error) {
      console.error("Failed to create inventory entity:", error);
    } finally {
      creatingEntity = false;
    }
  }

  async function handleModalCreate(data: {
    label: string;
    full_name: string;
    tags: string[];
    leaf: boolean;
    ports: PortData[];
  }): Promise<void> {
    isCreateModalOpen = false;
    const id = projectId;
    if (!id || creatingEntity) return;
    const label = data.label.trim();
    if (label === "" || label.includes("/")) return;
    // The definition is already there — open it rather than writing a no-op.
    if (definitions.some((d) => d.label === label)) {
      selectLabel(label);
      return;
    }
    creatingEntity = true;
    try {
      const fs = openProjectFs(projectStore, id);
      const targetPath = primaryHclPath(
        await fs.readdir(".", { recursive: true }),
      );
      const content = await fs.readFile(targetPath).catch(() => "");
      const result = await applyModelMutation(fs, targetPath, content, {
        kind: "add_component_definition",
        label,
        options: {
          leaf: data.leaf,
          full_name: data.full_name,
          tags: data.tags,
          ports: data.ports,
        },
      });
      if (!result.applied) return;
      await projectModel.reload();
      selectLabel(label);
    } catch (error) {
      console.error("Failed to create inventory entity:", error);
    } finally {
      creatingEntity = false;
    }
  }

  // The path is the definition's own label, which is what `update_component`
  // expects for a top-level definition. A system label is not a component path
  // at all and would be refused, which is why systems go through
  // `handleSystemStyleChange` (`update_system`) instead.
  let applyingStyle = $state(false);

  async function applyStyleOp(
    op:
      | { kind: "update_component"; patch: ComponentPatch }
      | {
          kind: "update_system";
          patch: SystemPatch;
        },
    errorMessage: string,
  ): Promise<void> {
    const id = projectId;
    const label = selectedDefinition?.label;
    if (!id || !label || applyingStyle) return;
    applyingStyle = true;
    try {
      const fs = openProjectFs(projectStore, id);
      const targetPath = primaryHclPath(
        await fs.readdir(".", { recursive: true }),
      );
      const content = await fs.readFile(targetPath).catch(() => "");
      const result = await applyModelMutation(fs, targetPath, content, {
        ...op,
        path: label,
      });
      if (!result.applied) return;
      await projectModel.reload();
    } catch (error) {
      console.error(errorMessage, error);
    } finally {
      applyingStyle = false;
    }
  }

  async function handleStyleChange(patch: ComponentPatch): Promise<void> {
    await applyStyleOp(
      { kind: "update_component", patch },
      "Failed to update inventory component style:",
    );
  }

  // Systems carry only `full_name` and `icon`: the `SystemPatch` type keeps
  // component-only keys from reaching the op, where Rust rejects them.
  async function handleSystemStyleChange(patch: SystemPatch): Promise<void> {
    await applyStyleOp(
      { kind: "update_system", patch },
      "Failed to update inventory system style:",
    );
  }

  // ── Protocols ──────────────────────────────────────────────────────────────
  // Protocol ops run through the same dispatcher as the rest of the page. A
  // refusal is always shown as a toast: unlike the other edits here, which fail
  // quietly, a protocol edit that did not apply has to say why.

  // Opens a protocol (or none) and makes the URL name it.
  function selectProtocol(label: string | null): void {
    selectedProtocol = label;
    navigateTo(inventoryProtocolHref(projectId, label));
  }

  // Clicking a tab. Leaving the Protocols tab moves the URL off `?tab=`, onto
  // an entity the new tab can show.
  function selectTab(tab: InventoryTab): void {
    activeTab = tab;
    if (tab === InventoryTab.Protocols) {
      navigateTo(inventoryProtocolHref(projectId, selectedProtocol));
      return;
    }
    if (page.url.searchParams.get("tab") !== InventoryTab.Protocols) return;
    const keep =
      selectedLabel !== null && visibleLabels.includes(selectedLabel);
    selectLabel(keep ? selectedLabel : (visibleLabels[0] ?? null), true);
  }

  // Applies one op and reports whether it landed. A refusal is shown with its
  // reason, and the caller decides what to do with the open protocol.
  async function applyProtocolOp(op: ModelMutationOp): Promise<boolean> {
    const id = projectId;
    if (!id) return false;
    try {
      const fs = openProjectFs(projectStore, id);
      const targetPath = primaryHclPath(
        await fs.readdir(".", { recursive: true }),
      );
      const content = await fs.readFile(targetPath).catch(() => "");
      const result = await applyModelMutation(fs, targetPath, content, op);
      if (!result.applied) {
        toastState.show(
          `Change refused: ${result.refusal ?? "the model would become invalid"}`,
          "error",
          8_000,
        );
        return false;
      }
      await projectModel.reload();
      return true;
    } catch (error) {
      console.error("Failed to change protocol:", error);
      return false;
    }
  }

  async function handleProtocolCreate(data: {
    label: string;
    full_name: string;
    leaf: boolean;
  }): Promise<void> {
    isCreateProtocolModalOpen = false;
    if (creatingEntity) return;
    // The protocol is already there — open it rather than writing a no-op.
    if (protocols.some((p) => p.label === data.label)) {
      selectProtocol(data.label);
      return;
    }
    creatingEntity = true;
    try {
      const applied = await applyProtocolOp({
        kind: "add_protocol",
        label: data.label,
        options: { full_name: data.full_name, leaf: data.leaf },
      });
      if (applied) selectProtocol(data.label);
    } finally {
      creatingEntity = false;
    }
  }

  async function handleProtocolUpdate(patch: ProtocolPatch): Promise<boolean> {
    const label = openProtocol?.label;
    if (label === undefined) return false;
    return applyProtocolOp({ kind: "update_protocol", path: label, patch });
  }

  async function handleDeleteProtocol(): Promise<void> {
    const label = openProtocol?.label;
    if (label === undefined) return;
    if (await applyProtocolOp({ kind: "delete_protocol", path: label })) {
      selectProtocol(null);
    }
  }

  // ── Deletion ───────────────────────────────────────────────────────────────
  // The Delete tab blocks while the entity is still referenced: a component
  // with live instances (its placements, by model key), a system with bound
  // views (which would dangle with E006). The blockers are recomputed from
  // the compiled model + sources on every render, so removing the last
  // instance/view unlocks the confirm input without a reload.
  let deleteBlockers = $derived.by<string[]>(() => {
    const label = selectedDefinition?.label;
    if (!label) return [];
    if (selectedIsSystem) {
      return viewsBoundToSystem(boundViews, label);
    }
    return instancePathsForDefinition(
      comps,
      model?.component_keys() ?? [],
      label,
    );
  });

  // Every `views/*.hcl` file with its bound system, parsed from the project
  // sources. Malformed view files are skipped — they are someone else's
  // diagnostic, not this tab's problem.
  let boundViews = $derived.by<{ path: string; system: string }[]>(() => {
    const views: { path: string; system: string }[] = [];
    for (const source of projectModel.sources) {
      if (!source.filename.startsWith(`${VIEW_LAYOUT_DIR}/`)) continue;
      if (!source.filename.endsWith(".hcl")) continue;
      try {
        for (const view of parse_views(source.content)) {
          views.push({ path: source.filename, system: view.system ?? "" });
        }
      } catch {
        /* Skip unparseable view files. */
      }
    }
    return views;
  });

  async function handleDeleteEntity(): Promise<void> {
    const id = projectId;
    const label = selectedDefinition?.label;
    if (!id || !label) return;
    try {
      const fs = openProjectFs(projectStore, id);
      const targetPath = primaryHclPath(
        await fs.readdir(".", { recursive: true }),
      );
      const content = await fs.readFile(targetPath).catch(() => "");
      const result = await applyModelMutation(
        fs,
        targetPath,
        content,
        selectedIsSystem
          ? { kind: "delete_system", path: label }
          : { kind: "delete_component", path: label },
      );
      if (!result.applied) return;
      await projectModel.reload();
      selectLabel(null);
    } catch (error) {
      console.error("Failed to delete inventory entity:", error);
    }
  }

  // Creates the missing component-specific view (`views/<label>.hcl`, bound
  // to the system that instantiates the definition) and opens Modeling on that
  // very view, addressed by its path.
  let creatingView = $state(false);

  async function handleCreateView(): Promise<void> {
    const def = selectedDefinition;
    const id = projectId;
    if (!def || !id || creatingView) return;
    creatingView = true;
    try {
      const fs = openProjectFs(projectStore, id);
      // A system binds its view to itself; a definition binds to the system
      // that instantiates it. Either way the diagram lives at
      // `views/<label>.hcl` — the same name the preview already probed.
      const system = selectedIsSystem
        ? def.label
        : preferredViewSystem(
            comps,
            model?.systems().map((s) => s.label) ?? [],
            def.label,
          );
      const path = defaultViewPath(def.label);
      await writeDiagramLayoutFile(
        fs,
        path,
        emptyDiagramLayout(system),
        system,
      );
      // The view's own path relative to `views/` — the modeling route is a rest
      // param, so this is a plain path suffix, `views/` already being implied.
      await goto(
        resolve("/projects/[id]/modeling/[...view]", {
          id,
          view: path.slice(`${VIEW_LAYOUT_DIR}/`.length),
        }),
      );
    } catch (error) {
      console.error("Failed to create inventory view:", error);
    } finally {
      creatingView = false;
    }
  }
</script>

<div
  data-testid="inventory-workspace"
  class="flex flex-col md:flex-row flex-1 w-full h-screen overflow-y-auto md:overflow-hidden bg-base-300"
>
  {#if !projectId}
    <div class="flex-1 flex items-center justify-center p-4">
      <div class="card bg-base-200 shadow-xl">
        <div class="card-body items-center text-center">
          <h2 class="card-title">No project selected</h2>
          <p class="text-base-content/60 text-sm">
            Select or create a project to browse its inventory.
          </p>
          <a href={resolve("/projects")} class="btn btn-primary mt-2">
            Back to projects
          </a>
        </div>
      </div>
    </div>
  {:else}
    <!-- Left panel: Inventory Browser. The Pane owns the header, width and
         hide/restore rail; the browser content below is unchanged. -->
    <Pane
      scope="inventory"
      title="Inventory Browser"
      side="left"
      width={layout.leftWidth}
      hidden={layout.leftHidden}
      onhide={() => (layout = inventoryPanes.hide(layout, "left"))}
      onshow={() => (layout = inventoryPanes.show(layout, "left"))}
    >
      <div class="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden p-3">
        <!-- Filter tabs -->
        <div
          class="flex items-center gap-1"
          role="tablist"
          aria-label="Inventory filters"
          data-tour={TOUR_TARGETS.inventory}
        >
          {#each INVENTORY_TABS as tab (tab)}
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              class="btn btn-xs {activeTab === tab
                ? 'btn-primary'
                : 'btn-ghost'}"
              onclick={() => selectTab(tab)}
            >
              {tab === InventoryTab.Components
                ? "Components"
                : tab === InventoryTab.Systems
                  ? "Systems"
                  : "Protocols"}
            </button>
          {/each}
          <button
            type="button"
            class="btn btn-primary btn-xs ml-auto"
            disabled={creatingEntity}
            onclick={() => void handleAddEntity()}
            data-testid="inventory-add-entity"
          >
            {creatingEntity ? "Creating…" : "+ New"}
          </button>
        </div>

        <!-- Free-text search -->
        <input
          type="search"
          class="input input-sm input-bordered w-full"
          placeholder="Search inventory…"
          aria-label="Search inventory"
          bind:value={query}
        />

        {#if activeTab !== InventoryTab.Protocols}
          <label class="label cursor-pointer justify-start gap-2 py-0">
            <input
              type="checkbox"
              class="checkbox checkbox-sm"
              bind:checked={onlyWithViews}
            />
            <span class="label-text text-sm">Only with defined views</span>
          </label>
        {/if}

        <!-- Entity list -->
        <div class="flex-1 overflow-y-auto flex flex-col gap-2 pr-1 min-h-0">
          {#if activeTab === InventoryTab.Protocols}
            {#if filteredProtocols.length === 0}
              <div
                class="flex-1 flex items-center justify-center text-sm text-base-content/50 p-4 text-center"
              >
                {#if protocols.length === 0}
                  No protocols in this model yet.
                {:else}
                  Nothing matches "{query}".
                {/if}
              </div>
            {:else}
              {#each filteredProtocols as protocol (protocol.label)}
                <ProtocolCard
                  {protocol}
                  portCount={protocolPortCounts.get(protocol.label) ?? 0}
                  selected={protocol.label === selectedProtocol}
                  onselect={(label) => selectProtocol(label)}
                />
              {/each}
            {/if}
          {:else if activeTab === InventoryTab.Systems}
            {#if filteredSystems.length === 0}
              <div
                class="flex-1 flex items-center justify-center text-sm text-base-content/50 p-4 text-center"
              >
                {#if systems.length === 0}
                  No systems in this model yet.
                {:else}
                  Nothing matches "{query}".
                {/if}
              </div>
            {:else}
              {#each filteredSystems.map(systemAsDefinition) as definition (definition.label)}
                <DefinitionCard
                  {definition}
                  selected={definition.label === selectedLabel}
                  showLevel={false}
                  onselect={(label) => selectLabel(label)}
                />
              {/each}
            {/if}
          {:else if filtered.length === 0}
            <div
              class="flex-1 flex items-center justify-center text-sm text-base-content/50 p-4 text-center"
            >
              {#if definitions.length === 0}
                No component definitions in this model yet.
              {:else}
                Nothing matches "{query}".
              {/if}
            </div>
          {:else}
            {#each filtered as definition (definition.label)}
              <DefinitionCard
                {definition}
                selected={definition.label === selectedLabel}
                onselect={(label) => selectLabel(label)}
              />
            {/each}
          {/if}
        </div>
      </div>
    </Pane>

    <Splitter
      testid="inventory-splitter-left"
      panelName="browser"
      value={layout.leftWidth}
      hidden={layout.leftHidden}
      onresize={(dx) =>
        (layout = inventoryPanes.resize(
          layout,
          "left",
          Math.min(
            layout.leftWidth + dx,
            viewportCap(SIDE_PANEL_WIDTH_FRACTION, "width"),
          ),
        ))}
    />

    <!-- Centre: the diagram preview fills whatever the panels leave over.
         Below `md` the workspace stacks and scrolls, so this wrapper is
         natural-height there (`flex-none`) and only stretches on desktop. -->
    <div class="flex flex-none md:flex-1 min-w-0 min-h-0">
      <div
        data-testid="inventory-diagram"
        class="relative flex-1 min-w-0 min-h-[320px] md:min-h-0 bg-base-300 flex items-center justify-center overflow-hidden"
      >
        {#if activeTab === InventoryTab.Protocols}
          <div
            class="flex h-full w-full items-center justify-center p-6 text-center text-sm text-base-content/60"
            data-testid="inventory-protocol-centre"
          >
            Protocols have no diagram. Their details are in the panel on the
            right.
          </div>
        {:else if selectedDefinition}
          <DiagramViewer
            {projectId}
            diagramPath={`${selectedDefinition.label}.hcl`}
            onSelectComponent={handleSelectNode}
            linkLabel={(node) => `${node.label}, open in inventory`}
          >
            {#snippet whenMissing()}
              <div
                class="flex h-full w-full items-center justify-center p-6 text-center"
                data-testid="inventory-empty-diagram"
              >
                <div class="card bg-base-200/80 border border-base-content/10">
                  <div class="card-body items-center max-w-md">
                    <p class="text-sm text-base-content/70">
                      Please create a default view diagram under
                      <code
                        class="text-base-content bg-base-300 rounded px-1 py-0.5"
                      >
                        {emptyStatePath}
                      </code>
                    </p>
                    <button
                      type="button"
                      class="btn btn-primary btn-sm mt-3"
                      disabled={creatingView}
                      onclick={() => void handleCreateView()}
                      data-testid="inventory-create-view"
                    >
                      {creatingView
                        ? "Creating…"
                        : selectedIsSystem
                          ? "Create a view for this system"
                          : "Create a view for this component"}
                    </button>
                  </div>
                </div>
              </div>
            {/snippet}
          </DiagramViewer>
        {:else}
          <div
            class="flex h-full w-full items-center justify-center text-sm text-base-content/60 p-4 text-center"
          >
            Select an entity to preview its default diagram.
          </div>
        {/if}
      </div>
    </div>

    <Splitter
      testid="inventory-splitter-right"
      panelName="details"
      value={layout.rightWidth}
      hidden={layout.rightHidden}
      onresize={(dx) =>
        (layout = inventoryPanes.resize(
          layout,
          "right",
          Math.min(
            layout.rightWidth - dx,
            viewportCap(SIDE_PANEL_WIDTH_FRACTION, "width"),
          ),
        ))}
    />

    <!-- Right panel: entity details. The DetailPane content is unchanged. -->
    <Pane
      scope="inventory"
      title="Details"
      side="right"
      width={layout.rightWidth}
      hidden={layout.rightHidden}
      onhide={() => (layout = inventoryPanes.hide(layout, "right"))}
      onshow={() => (layout = inventoryPanes.show(layout, "right"))}
    >
      {#if activeTab === InventoryTab.Protocols}
        {#if openProtocol !== null && openProtocolUsage !== null}
          <ProtocolDetailPane
            {projectId}
            protocol={openProtocol}
            allProtocols={protocols}
            messages={openProtocolMessages}
            usage={openProtocolUsage}
            onupdate={handleProtocolUpdate}
            ondelete={handleDeleteProtocol}
          />
        {:else}
          <div
            class="flex-1 flex items-center justify-center text-sm text-base-content/50 p-4 text-center"
          >
            Select a protocol in the Inventory Browser to inspect it.
          </div>
        {/if}
      {:else}
        <DetailPane
          definition={selectedDefinition}
          {docContent}
          ondocsave={handleSaveDoc}
          onstylechange={selectedIsSystem ? undefined : handleStyleChange}
          onsystemstylechange={selectedIsSystem
            ? handleSystemStyleChange
            : undefined}
          {deleteBlockers}
          deleteBlockerKind={selectedIsSystem ? "view" : "instance"}
          ondelete={handleDeleteEntity}
        />
      {/if}
    </Pane>

    <CreateComponentModal
      isOpen={isCreateModalOpen}
      availableParents={modalParents}
      reusableDefinitions={[]}
      allowReuse={false}
      defaultParentKey={modalParents[0]?.key}
      oncreate={(data) => void handleModalCreate(data)}
      onclose={() => (isCreateModalOpen = false)}
    />
    <CreateSystemModal
      isOpen={isCreateSystemModalOpen}
      oncreate={(label) => void handleSystemCreate(label)}
      onclose={() => (isCreateSystemModalOpen = false)}
    />
    <CreateProtocolModal
      isOpen={isCreateProtocolModalOpen}
      existingLabels={protocols.map((p) => p.label)}
      oncreate={(data) => void handleProtocolCreate(data)}
      onclose={() => (isCreateProtocolModalOpen = false)}
    />
  {/if}
</div>
