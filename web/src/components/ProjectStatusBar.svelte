<script lang="ts">
  // Adapts the shared ProjectModel to DiagnosticsStatusBar's prop API, so the
  // bar keeps rendering from plain props (and its stories keep passing
  // fixtures) while the app feeds it the same compile every page sees.
  import DiagnosticsStatusBar from "./DiagnosticsStatusBar.svelte";
  import { getProjectModel } from "../ProjectModel.svelte";

  const projectModel = getProjectModel();
</script>

<DiagnosticsStatusBar
  diagnostics={projectModel.diagnostics}
  score={projectModel.score ?? null}
/>
