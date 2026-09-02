<script lang="ts">
import Inventory from "./Inventory.svelte";
import type { PageProps } from "./$types";

let { data }: PageProps = $props();
</script>

<Inventory projectId={data.projectId} />
