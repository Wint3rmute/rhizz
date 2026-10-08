<script lang="ts">
import CodePage from "./CodePage.svelte";
import type { PageProps } from "./$types";

let { data }: PageProps = $props();
</script>

<CodePage projectId={data.projectId} />
