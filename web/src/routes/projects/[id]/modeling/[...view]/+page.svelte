<script lang="ts">
// Thin route shell: the editor itself is ModelingPage, which the page-level
// stories render directly. The only thing this file owns is handing the route
// parameter over as a prop.
import ModelingPage from "../ModelingPage.svelte";
import type { PageProps } from "./$types";

let { data }: PageProps = $props();
</script>

<ModelingPage projectId={data.projectId} requestedView={data.view} />
