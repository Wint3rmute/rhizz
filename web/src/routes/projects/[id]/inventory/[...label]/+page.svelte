<script lang="ts">
// Thin route shell: the browser itself is Inventory, which the page stories
// render directly. The only thing this file owns is handing the route
// parameter over as a prop.
import Inventory from "../Inventory.svelte";
import type { PageProps } from "./$types";

let { data }: PageProps = $props();
</script>

<Inventory projectId={data.projectId} requestedLabel={data.label} />
