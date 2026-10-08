<script lang="ts">
// Thin route shell: the dashboard itself is Overview, which the page-level
// stories render directly. The only thing this file owns is handing the route
// parameter over as a prop.
import Overview from "./Overview.svelte";
import type { PageProps } from "./$types";

let { data }: PageProps = $props();
</script>

<Overview projectId={data.projectId} />
