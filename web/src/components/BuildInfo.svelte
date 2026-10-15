<script lang="ts">
  import { fetchBuildInfo, type BuildInfo } from "../buildInfo";

  // The commit the running `rhizz web` server was built from, shown as a
  // footer. Only a server build exposes `/api/version`; the browser-only build
  // has no server to ask, so nothing renders there. The Vite dev server has no
  // server either, so it shows a `dev server` label instead of staying empty.
  //
  // `buildInfo` is an injection seam for Storybook/tests: absent (or an
  // explicit `undefined`) means "uncontrolled" (fetch from the server), while
  // any other value — including `null` — is rendered as given and never
  // fetched. `undefined` is spelled out because `exactOptionalPropertyTypes`
  // makes an optional property reject an explicit `undefined` otherwise.
  interface Props {
    buildInfo?: BuildInfo | null | undefined;
  }

  let { buildInfo }: Props = $props();

  const serverUrl = import.meta.env.VITE_RHIZZ_SERVER_URL as string | undefined;
  let fetched = $state<BuildInfo | null>(null);
  if (serverUrl) {
    void fetchBuildInfo(serverUrl).then((info) => {
      fetched = info;
    });
  } else if (import.meta.env.DEV) {
    // The dev server has no `/api/version` to ask, so label the build
    // explicitly rather than leaving the footer empty.
    fetched = { git_sha: "dev server" };
  }

  let info = $derived(buildInfo !== undefined ? buildInfo : fetched);

  // A git revision is hex; `dev` (local build) and `unknown` (no revision in
  // the flake) are not commits, so they get no link rather than a broken one.
  let isCommit = $derived(
    info !== null && /^[0-9a-f]{7,40}$/i.test(info.git_sha),
  );

  const COMMIT_URL = "https://github.com/Wint3rmute/rhizz/commit/";
</script>

{#if info}
  <footer class="text-xs text-base-content/50 font-mono text-center">
    {#if isCommit}
      <a
        class="link link-hover"
        href={`${COMMIT_URL}${info.git_sha}`}
        target="_blank"
        rel="noopener noreferrer"
        title="Open this build's commit on GitHub"
      >
        rhizz build {info.git_sha}
      </a>
    {:else}
      rhizz build {info.git_sha}
    {/if}
  </footer>
{/if}
