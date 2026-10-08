<script lang="ts">
// Thin route shell: the editor itself is CodePage, which the page-level
// stories render directly. The only thing this file owns is handing the route
// parameter over as a prop.
import CodePage from "./CodePage.svelte";
import type { PageProps } from "./$types";

let { data }: PageProps = $props();
</script>

<CodePage projectId={data.projectId} />
