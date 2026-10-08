<script lang="ts">
import Overview from "./Overview.svelte";
import type { PageProps } from "./$types";

let { data }: PageProps = $props();
</script>

<Overview projectId={data.projectId} />
