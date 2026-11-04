<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onDestroy } from "svelte";
  import ProjectModelProvider from "../../../components/ProjectModelProvider.svelte";
  import ProjectStatusBar from "../../../components/ProjectStatusBar.svelte";
  import {
    clearCurrentProject,
    getCurrentProject,
    getServerBaseUrl,
    setCurrentProject,
  } from "../../../ProjectState.svelte";
  import { projectLock } from "../../../collab/projectLock.svelte";
  import { toastState } from "../../../ToastState.svelte";
  import ProjectTour from "../../../tour/ProjectTour.svelte";
  import PaletteHost from "../../../commands/PaletteHost.svelte";
  import {
    formatPageTitle,
    pageLabelForPath,
  } from "../../../commands/pageTitle";
  import type { LayoutProps } from "./$types";

  let { data, children }: LayoutProps = $props();

  // Reloads the active project's metadata into the shared ProjectState
  // whenever the route's [id] param changes (including the very first
  // load) — this is what lets Navbar (which lives outside this layout,
  // in the root +layout.svelte) know which project is active without
  // prop-drilling. The project's *compiled model* is loaded separately by the
  // ProjectModelProvider below; the two are deliberately split, because Navbar
  // needs only metadata and the pages need the model.
  let loadedId: string | null = null;
  let loading = $state(true);

  // Leaving all project routes unmounts this layout: drop the active
  // project so nothing (navbar links, tour flow) keeps acting on it.
  onDestroy(() => {
    clearCurrentProject();
    projectLock.stop();
  });

  // A full document unload (reload, closed tab) never runs that teardown:
  // give the server a best-effort goodbye so the lock frees at once instead
  // of waiting out the lease, then stop polling a dead document.
  function handlePageHide(): void {
    void projectLock.release();
    projectLock.stop();
  }

  // Set once a version has been seen: a later version-less poll means the
  // project was deleted out from under this tab.
  let sawVersion = false;

  $effect(() => {
    const id = data.projectId;
    if (id === loadedId) return;
    loadedId = id;
    loading = true;
    // A new project starts unseen: without this, the null version between
    // stop() and the first poll would read as a deletion of the old one.
    sawVersion = false;
    setCurrentProject(id).then(() => {
      loading = false;
    });
    // Track this project's lock (a no-op poller for local/memory
    // backends): the badge and every editor's read-only flag follow it.
    projectLock.start(id, getServerBaseUrl());
  });

  // A version that was known and goes missing means the project was
  // deleted elsewhere (the state endpoint 404s): toast and leave for the
  // project list. Local backends never report a version, so they never
  // trigger this. pollSeq is read so a 404 that persists across polls
  // still re-runs this effect after a project switch resets the flag.
  $effect(() => {
    const version = projectLock.version;
    void projectLock.pollSeq;
    if (version !== null) {
      sawVersion = true;
      return;
    }
    if (!sawVersion) return;
    sawVersion = false;
    toastState.show("This project was deleted", "warning");
    void goto(resolve("/projects"));
  });

  // Diagram embeds are project-scoped, so they sit under this layout like
  // every other project route — but they are chromeless iframe surfaces, not
  // pages you navigate around in, so they drop the status bar.
  let isEmbed = $derived(page.url.pathname.includes("/embed/"));

  let project = $derived(getCurrentProject());

  // Browser tab: "Rhizz: <project> - <page>", reactive to navigation and
  // renames. Falls back to the static <title> in app.html off project pages.
  let tabTitle = $derived(
    formatPageTitle(project?.name ?? null, pageLabelForPath(page.url.pathname)),
  );
</script>

<svelte:head>
  <title>{tabTitle}</title>
</svelte:head>

<svelte:window onpagehide={handlePageHide} />

{#if loading}
  <div class="flex-1 flex items-center justify-center text-base-content/60">
    Loading project…
  </div>
{:else if project === null}
  <div class="flex-1 flex items-center justify-center">
    <div class="card bg-base-200 shadow-xl">
      <div class="card-body items-center text-center">
        <h2 class="card-title">Project not found</h2>
        <p class="text-base-content/60 text-sm">
          No project exists with id "{data.projectId}".
        </p>
        <a href={resolve("/projects")} class="btn btn-primary mt-2">
          Back to projects
        </a>
      </div>
    </div>
  </div>
{:else}
  <!-- One compiled model per open project, shared by every page and by the
       status bar, so they can never describe different compiles. -->
  <ProjectModelProvider projectId={data.projectId}>
    <div class="flex-1 flex flex-col min-h-0">
      {@render children()}
      {#if !isEmbed}
        <ProjectStatusBar />
      {/if}
    </div>
    <!-- Workspace guided tour: mounted here (not per-page) so it
         survives the cross-page navigation its steps perform. -->
    <ProjectTour projectId={data.projectId} />
    <!-- Ctrl-P / Ctrl-Shift-P palettes. Mounted here for the same reason,
         and skipped on embeds because those are chromeless iframe surfaces
         (the status bar above makes the same call). Mounting inside the
         project layout is also what confines the palettes to a project being
         open, with no check of its own. -->
    {#if !isEmbed}
      <PaletteHost projectId={data.projectId} />
    {/if}
  </ProjectModelProvider>
{/if}
