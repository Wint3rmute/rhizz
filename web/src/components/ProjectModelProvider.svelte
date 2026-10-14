<script lang="ts">
  // Provides a single ProjectModel to everything below it. The projects/[id]
  // layout mounts one per open project; Storybook's global decorator mounts one
  // around any page story that carries a `projectId` arg, so the page components
  // (which read the model from context) render standalone exactly as they do in
  // the app.
  import type { Snippet } from "svelte";
  import { ProjectModel, setProjectModel } from "../ProjectModel.svelte";

  let {
    projectId = null,
    children,
  }: {
    projectId?: string | null;
    children: Snippet;
  } = $props();

  const model = new ProjectModel();
  setProjectModel(model);

  $effect(() => {
    void model.open(projectId);
  });
</script>

{@render children()}
