<script lang="ts">
import Explore from "./Explore.svelte";
import type { PageProps } from "./$types";

let { data }: PageProps = $props();
</script>

<Explore projectId={data.projectId} />
