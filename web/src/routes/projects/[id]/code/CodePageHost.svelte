<script lang="ts">
// Story host only: CodePage's root is `flex-1` (the app shell above it owns
// the height — see routes/+layout.svelte's `h-screen flex flex-col`), and a
// Storybook story root has no height of its own. Without one the page
// collapses to its content height and the editor below the fold paints
// nothing, so VRT would pin a half-empty page. Same reason MonacoEditorHost
// supplies an explicit box.
import CodePage from "./CodePage.svelte";

let { projectId }: { projectId: string } = $props();
</script>

<div class="h-screen w-screen flex flex-col bg-base-100 text-base-content">
  <CodePage {projectId} />
</div>
