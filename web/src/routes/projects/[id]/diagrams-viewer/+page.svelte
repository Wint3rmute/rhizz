<script lang="ts">
import DiagramViewer from "./DiagramViewer.svelte";
import type { PageProps } from "./$types";

let { data }: PageProps = $props();
</script>

<DiagramViewer projectId={data.projectId} />
