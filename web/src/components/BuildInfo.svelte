<script lang="ts">
  import { fetchBuildInfo, type BuildInfo } from "../buildInfo";
  import { trackedFetch } from "../netActivity";
  import { REPO_URL } from "../links";

  // The commit the running `rhizome web` server was built from, shown as a
  // footer. Only a server build exposes `/api/version`; the browser-only build
  // has no server to ask, so nothing renders there. The Vite dev server has no
  // server either, so it shows a `dev server` label instead of staying empty.
  //
  // `buildInfo` is an injection seam for Storybook/tests: absent (or an
  // explicit `undefined`) means "uncontrolled" (fetch from the server), while
  // any other value — including `null` — is rendered as given and never
  // fetched. `undefined` is spelled out because `exactOptionalPropertyTypes`
  // makes an optional property reject an explicit `undefined` otherwise.
  // A tagged build (`git_tag` present) renders `1.2.3 (05eeb57)` and links
  // to the release tag; an untagged one renders just the commit and links
  // to it.
  interface Props {
    buildInfo?: BuildInfo | null | undefined;
  }

  let { buildInfo }: Props = $props();

  const serverUrl = import.meta.env.VITE_RHIZOME_SERVER_URL as
    string | undefined;
  let fetched = $state<BuildInfo | null>(null);
  if (serverUrl) {
    // Background noise for the activity widget (`/api/version` never shows).
    void fetchBuildInfo(serverUrl, trackedFetch).then((info) => {
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

  // Release tag, if this build comes from a tagged commit.
  let tag = $derived(
    info?.git_tag !== undefined && info.git_tag !== "" ? info.git_tag : null,
  );

  const COMMIT_URL = `${REPO_URL}/commit/`;
  const TAG_URL = `${REPO_URL}/releases/tag/`;
</script>

{#if info}
  <footer class="text-xs text-base-content/50 font-mono text-center">
    {#if tag}
      <a
        class="link link-hover"
        href={`${TAG_URL}${encodeURIComponent(tag)}`}
        target="_blank"
        rel="noopener noreferrer"
        title="Open this build's release on GitHub"
      >
        rhizome build {tag} ({info.git_sha})
      </a>
    {:else if isCommit}
      <a
        class="link link-hover"
        href={`${COMMIT_URL}${info.git_sha}`}
        target="_blank"
        rel="noopener noreferrer"
        title="Open this build's commit on GitHub"
      >
        rhizome build {info.git_sha}
      </a>
    {:else}
      rhizome build {info.git_sha}
    {/if}
  </footer>
{/if}
