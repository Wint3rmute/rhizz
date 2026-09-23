# Visual regression tests (VRT)

A local Chromatic replacement: a full-page screenshot of every Storybook
story in dark and light, diffed against baselines in `__screenshots__/`
(committed), with a static review gallery.

```bash
just vrt              # rebuild wasm + Storybook, screenshot, diff
just vrt-quick        # same, reusing the existing storybook-static/ build
just vrt -g navbar    # extra args go to Playwright (filter by story id)
just vrt-accept       # re-baseline everything that changed / is new
```

Every run writes `web/vrt-report/index.html` (gitignored). Open it straight
from disk. It lists changed, new and broken stories with slider,
side-by-side and diff views, a per-story "copy accept command" (`cp` of the
new image over the baseline), and a grid of the unchanged baselines.

- **New story:** picked up automatically from `storybook-static/index.json`.
  The first run shows it as "New" and writes its baseline.
- **Opt out:** add `tags: ["no-vrt"]` to a story.
- **Viewports:** stories using Storybook's `mobile1`/`mobile2`/`tablet`/
  `desktop` viewport are screenshotted at that size; everything else at
  1280×800.
- Not part of `just test` or CI (separate `playwright.vrt.config.ts`).

## Git LFS

Baselines (`__screenshots__/*.png`) are stored in Git LFS (see the repo-root
`.gitattributes`). After cloning, run `git lfs install && git lfs pull`.
Without LFS the PNGs are small text pointer files and every story shows as
changed. A CI job running `just vrt` needs `lfs: true` on
`actions/checkout`.
