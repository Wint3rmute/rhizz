# Visual Test Dedup — removal and consolidation log

## 1. Inventory

**How stories are discovered and screenshotted:**

- `web/.storybook/main.ts`: `stories: ["../src/**/*.stories.@(js|jsx|ts|tsx|svelte)"]`
- `web/.storybook/preview.ts`: global `withThemeByDataAttribute({dark, light})`, `withProjectModel`, `tags: ["autodocs"]`
- `web/playwright.vrt.config.ts`:
  - `testDir: ./vrt`, `snapshotPathTemplate: {testDir}/__screenshots__/{arg}{ext}`
  - `threshold: 0.02`, `animations: disabled`, `caret: hide`, `scale: css`
  - `viewport: 1280x800`, `locale: en-US`, `timezone: UTC`, `colorScheme: dark` (overridden per-theme), `reducedMotion: reduce`
  - Deterministic Chromium flags + `RHIZZ_VRT_FONTCONFIG_FILE` (Nix devshell, `just vrt`)
- `web/vrt/stories.spec.ts`:
  - Loads `storybook-static/index.json`, filters `type === "story"` and `!tags.includes("no-vrt")`
  - Runs each story × `dark, light` via `/iframe.html?id=<storyId>&viewMode=story&globals=theme:<theme>`
  - Viewport override only for Storybook MINIMAL_VIEWPORTS `mobile1 (320x568)`, `mobile2 (414x896)`, `tablet (834x1112)`, `desktop (1280x1024)` via `globals.viewport.value` or `parameters.viewport.defaultViewport`. Custom viewports (e.g. Inventory `narrowPane 414x896`) are **ignored** → falls back to default 1280x800.
  - `fullPage: true`, `pinViewportHeight`, `waitForStableLayout`, `waitForMonacoChrome`, `hideBlinkingCursors`, optional `parameters.vrtHoverText` hover
- `web/vrt/backgrounds.spec.ts`: 4 live-app light-theme captures (`apollo-11` example) → `backgrounds-background-{1..4}--light.png`. Source of truth for `web/src/screenshots/background_*.png` and `book/src/rhizz_landing.png` via `just vrt-accept`.
- `web/vrt/README.md`: `just vrt` (rebuild wasm+Storybook, diff), `just vrt-quick` (reuse build), `just vrt-accept` (re-baseline + copy backgrounds). Baselines in Git LFS (`web/vrt/__screenshots__/*.png`).

**Locales/themes/viewports:** all stories `en-US`, `dark+light`, 1280x800 unless noted below as `mobile1` or `responsive`.

**Pre-change counts (measured 2026-10-30):**

- `storybook-static/index.json`: 200 stories total, 21 `no-vrt`, **179 VRT stories**
- `web/vrt/__screenshots__/`: **184 unique bases** (180 story + 4 backgrounds), **364 files** (180×2 + 4)
- Discrepancy 180 vs 179: `diagrams-deleteconnectionmodal--no-ports` (2 files) orphaned — story removed in FINISHED task "Remove port-less connection support" but baselines left behind. No other orphans. No missing baselines (every VRT id had a snapshot).
- `just vrt` would run 179×2+4 = **362 tests**.

**Byte-identical groups (sha256, per theme — proof of redundancy):**

- `commands-palettehost--commands-and-files-in-one-list` == `commands-come-first` (`18efb3…`, `b6bf55…`)
- `commands-palettehost--component-icons-on-inventory` == `inventory-section-on-inventory` (`f8a70d…`, `ba9c94…`)
- `commands-palettehost--escape-closes` == `components-scorebadge--no-score` == `diagrams-diagramstaticview--empty` (`9ac977…`, `3eab34…`) — all blank
- `components-palette-commandpalette--browse-all` == `enter-runs-the-action` == `escape-closes` == `scrim-without-blur` (`3b9fe0…`, `a9d722…`)
- `diagrams-connectioninspector--attribute-scopes` == `default` (`42f373…`, `eb502e…`)
- `diagrams-connectioninspector--port-connection-status` == `realized` (`098e47…`, `8dee97…`)
- `diagrams-nodeinspector--attribute-scopes` == `default` (`5dfc39…`, `c2d399…`)
- `overview-diagnosticsstatusbar--expanded` == `resizable-panel` (`24d80b…`, `b1f9b1…`)
- `pages-diagrams-modeling-panes--components-pane-hide-and-restore` == `panes-hide-and-restore` == `panes-open-by-default` (`350552…`, `c5bea1…`)
- `pages-diagrams-open-view-url--deep-linked-view` == `unknown-view-reopens-remembered` (`6893d3…`, `2f7526…`)
- `pages-inventory--desktop` == `detail-pane-stacks-below-the-diagram` == `documentation-tab` == `panes-open-by-default` (`56f562…`, `66acde…`)

Screenshots for each group were viewed to confirm same pixels, not just same hash. Representative images: PaletteHost inventory list shows Navigate+Inventory sections with sensor/pump icons; CommandPalette open list (8 rows); ConnectionInspector fund-transfer with endpoint ports + protocol + realization + view sides; Diagnostics expanded panel (E002+2×W004, strip with counts); ModelingPanes default workspace (battery node, both sidebars open); Inventory Desktop (battery list + diagram + Battery doc).

## 2. Removal and consolidation log

No new composite `Showcase` stories were added. Rationale: the kept representatives **already are** the large-surface composites (e.g. `BrowseAll` shows the full palette, `Desktop` shows the full Inventory page, `PanesOpenByDefault` shows the full Modeling workspace, `FullStrip` shows the score badge in situ). Creating additional composites would duplicate those surfaces without adding coverage. All removals are `tags: ["no-vrt"]` (VRT opt-out) — `play` functions still run in vitest/browser, so functional coverage is preserved; only the duplicate screenshot is dropped.

| Removed story | Component | Snapshots removed | Replacement | Justification |
|---|---|---|---|---|
| `Commands/PaletteHost / CommandsComeFirst` | `PaletteHost` | `commands-palettehost--commands-come-first--dark.png`, `--light.png` | `Commands/PaletteHost / CommandsAndFilesInOneList` | Same untouched palette, same pixels (identical hash). Replacement asserts list contents + sections; removed asserts first-row order via play (still runs). |
| `Commands/PaletteHost / InventorySectionOnInventory` | `PaletteHost` | `commands-palettehost--inventory-section-on-inventory--dark.png`, `--light.png` | `Commands/PaletteHost / ComponentIconsOnInventory` | Same untouched inventory palette (identical hash). Kept checks icon-slot alignment (visual regression most likely); removed section assertions still run via play. |
| `Commands/PaletteHost / EscapeCloses` | `PaletteHost` | `commands-palettehost--escape-closes--dark.png`, `--light.png` | `Diagrams/DiagramStaticView / Empty` (blank representative) | Blank capture (palette closed). Byte-identical to ScoreBadge/NoScore and StaticView/Empty. No pixels to pin; close behavior still asserted via play. |
| `Components/ScoreBadge / NoScore` | `ScoreBadge` | `components-scorebadge--no-score--dark.png`, `--light.png` | `Diagrams/DiagramStaticView / Empty` | Blank (renders nothing). Byte-identical to above. Null-render still asserted via play (`queryByText(/Score:/)` null). |
| `Components/Palette/CommandPalette / EnterRunsTheAction` | `CommandPalette` | `components-palette-commandpalette--enter-runs-the-action--dark.png`, `--light.png` | `Components/Palette/CommandPalette / BrowseAll` | Same open 8-row palette (identical hash; `isOpen` stays true, Enter only fires callback). Callback still asserted via play. |
| `Components/Palette/CommandPalette / ClickRunsTheAction` | `CommandPalette` | `components-palette-commandpalette--click-runs-the-action--dark.png`, `--light.png` | `BrowseAll` | Same as above; click callback still asserted via play. |
| `Components/Palette/CommandPalette / EscapeCloses` | `CommandPalette` | `components-palette-commandpalette--escape-closes--dark.png`, `--light.png` | `BrowseAll` | Same as above (`isOpen` controlled prop, so Escape does not visually close). Close callback still asserted via play. |
| `Components/Palette/CommandPalette / ScrimWithoutBlur` | `CommandPalette` | `components-palette-commandpalette--scrim-without-blur--dark.png`, `--light.png` | `BrowseAll` | Same open palette (identical hash). No-blur/scrim CSS still asserted via `getComputedStyle` in play. |
| `Diagrams/ConnectionInspector / AttributeScopes` | `ConnectionInspector` | `diagrams-connectioninspector--attribute-scopes--dark.png`, `--light.png` | `Diagrams/ConnectionInspector / Default` | Same args except `sharedWithCopies` (tooltip-only, invisible in screenshot). Panel split still asserted via play. |
| `Diagrams/ConnectionInspector / Realized` | `ConnectionInspector` | `diagrams-connectioninspector--realized--dark.png`, `--light.png` | `Diagrams/ConnectionInspector / PortConnectionStatus` | Same `fund-transfer` realized connection (identical hash). Kept has play (per-instance Connected badges); removed had no play. |
| `Diagrams/NodeInspector / AttributeScopes` | `NodeInspector` | `diagrams-nodeinspector--attribute-scopes--dark.png`, `--light.png` | `Diagrams/NodeInspector / Default` | Same empty args (identical hash). Component/view panel split still asserted via play. |
| `Overview/DiagnosticsStatusBar / ResizablePanel` | `DiagnosticsStatusBar` | `overview-diagnosticsstatusbar--resizable-panel--dark.png`, `--light.png` | `Overview/DiagnosticsStatusBar / Expanded` | Same expanded 3-row panel + strip (identical hash, slider visible in both). Kept asserts color seam (visual); removed resize/hide cycle still runs via play. |
| `Pages/Diagrams/Modeling Panes / PanesHideAndRestore` | `ModelingPage` | `pages-diagrams-modeling-panes--panes-hide-and-restore--dark.png`, `--light.png` | `Pages/Diagrams/Modeling Panes / PanesOpenByDefault` | All three end open (identical hash; hide→restore). Hide/restore still asserted via play. |
| `Pages/Diagrams/Modeling Panes / ComponentsPaneHideAndRestore` | `ModelingPage` | `pages-diagrams-modeling-panes--components-pane-hide-and-restore--dark.png`, `--light.png` | `PanesOpenByDefault` | Same as above (components side). |
| `Pages/Diagrams/Open View URL / UnknownViewReopensRemembered` | `ModelingPage` | `pages-diagrams-open-view-url--unknown-view-reopens-remembered--dark.png`, `--light.png` | `Pages/Diagrams/Open View URL / DeepLinkedView` | Both end on `actuator.hcl` (identical hash; remembered-view fallback lands on same view as deep link). Fallback still asserted via play. `UnknownViewFallsBack` (main.hcl) kept as distinct. |
| `Pages/Inventory / DetailPaneStacksBelowTheDiagram` | `Inventory` | `pages-inventory--detail-pane-stacks-below-the-diagram--dark.png`, `--light.png` | `Pages/Inventory / Desktop` | VRT ignores custom `narrowPane` viewport → captures at 1280 wide (identical to Desktop). Narrow stacking (`flexDirection: column`) only asserted via play; VRT never covered it. |
| `Pages/Inventory / DocumentationTab` | `Inventory` | `pages-inventory--documentation-tab--dark.png`, `--light.png` | `Pages/Inventory / Desktop` | Ends on Battery viewer (identical hash). Open/cancel editor cycle still runs via play. |
| `Pages/Inventory / PanesOpenByDefault` | `Inventory` | `pages-inventory--panes-open-by-default--dark.png`, `--light.png` | `Pages/Inventory / Desktop` | Same wide capture (identical hash; VRT ignores `narrowPane`). Pane visibility still asserted via play. |
| `(orphan) diagrams-deleteconnectionmodal--no-ports` | — | `diagrams-deleteconnectionmodal--no-ports--dark.png`, `--light.png` | — (story deleted in "Remove port-less connection support") | Snapshot left behind after VRT `NoPorts` story removal (FINISHED.md). No story produces it; `just vrt` ignores it. Deleted. No replacement (port-less unrepresentable). |

## 3. Flagged items (ambiguous, left in place)

- **Blank trio representative kept:** `Diagrams/DiagramStaticView / Empty` retained as the single blank baseline (empty-canvas fallback `0 0 100 100`). It pins "renders without error" via `sb-show-main`. Alternatives (tag all three blanks `no-vrt`) would leave zero blank baselines; kept one to preserve the empty-state signal.
- **Narrow-viewport stories:** `DetailPaneStacksBelowTheDiagram`, Inventory `PanesOpenByDefault` (and `EveryTabFitsInThePane` which forces overflow deterministically) claim narrow viewports via custom `narrowPane`, but `stories.spec.ts` only honors `mobile1/mobile2/tablet/desktop`. Their VRT baselines are wide duplicates. Left their `play` assertions (which do set the custom viewport in the vitest browser) intact; did not change VRT harness (out of scope — would affect all stories). Flagged for future harness work if true narrow VRT is wanted.
- **Tour/Walk 14 stops:** no byte-duplicates, but visually similar (same workspace + different tour card). Kept all — each card/spotlight/progress is distinct UI state that cannot appear together.
- **TipsPanel First/Second, ToastContainer AllLevels/MarkdownMessage, VerdictPanel Ok/Warnings/Errors, DiagnosticsStatusBar Collapsed/Clean/Duplicate/FullStrip/NarrowStrip:** single-element or state variants that cannot co-occur (loading vs empty vs error, first vs second tip). Kept per task rule.
- **CommandPalette `ScrollsHighlightIntoView`, BuildInfo `Hidden`, ComponentStyleFields ×3, DiagramCanvas ×4, DiagramViewer, ArrowNudge ×3, MixedSelection ×3, SpawnAtCursor ×2, Tour `AllStepsCovered`, Navbar `ProjectOpen`:** already `no-vrt` (interaction/scroll-geometry only). Untouched.
- **Near-duplicates not byte-identical (kept):** e.g. `Explore / Desktop` vs `ManyDiagramsDesktop` vs `CrossLevelConnections`; `Projects / WithProjects` vs `EmptyLanding`; `Code / Default` vs `FileTree / Default+Empty`; `DiagramStaticView` Pipeline vs SingleSelected vs Nested vs Icons vs NodeVisualStyles vs SingleKnee vs DoubleKnee — each adds nodes/edges/selection/routing. Viewed; not identical, so kept.
- **ScoreBadge/WithScore vs DiagnosticsStatusBar/FullStrip:** FullStrip includes a score badge, but cropped to the strip at phone width in VRT; ScoreBadge/WithScore is centered layout with exact 73% + tooltip. Not identical; kept both.

## 4. Coverage mapping (each distinct UI state → covering story)

- Palette untouched (Navigate+Files): `Commands/PaletteHost / CommandsAndFilesInOneList`
- Palette on Modeling (Views section, diagrams only): `DiagramsOnlyOnModeling`, `FindsAView` (filtered)
- Palette on Inventory (Navigate+Inventory, icons, no files): `ComponentIconsOnInventory` (covers `InventorySectionOnInventory`)
- Palette search (entity vs file, full-name): `InventoryFindsEntitiesNotFiles`, `InventoryFindsByFullName`
- Palette closed (blank): `DiagramStaticView / Empty` (representative)
- CommandPalette open 8 rows + highlight + groups: `BrowseAll` (covers Enter/Click/Escape/Scrim visually)
- CommandPalette filtered/highlighted: `FuzzyFiltered`, `GappedWordsStillFindTheRow`, `GroupsHiddenWhileSearching`, `NoMatches`, `Loading`, `ArrowKeysWrapAround`, `TextAndSvgGlyphsShareOneSlot`
- ConnectionInspector default (no realization): `Default` (covers `AttributeScopes` visually)
- ConnectionInspector realized chain: `PortConnectionStatus` (covers `Realized` visually)
- ConnectionInspector incomplete / undefined-protocol: `Incomplete`, `UndefinedProtocol` (distinct)
- NodeInspector default / styled / atomic / sourced: `Default` (covers `AttributeScopes`), `Styled`, `AtomicLeaf`, `Sourced`
- Diagnostics strip collapsed / counts / strictness: `Collapsed`, `Clean`, `DuplicateDiagnostics`, `FullStrip`, `NarrowStrip` (mobile1)
- Diagnostics expanded panel: `Expanded` (covers `ResizablePanel` visually)
- Modeling workspace both panes open: `PanesOpenByDefault` (covers hide/restore visually)
- Open view deep-link / fallback: `DeepLinkedView`, `UnknownViewFallsBack` (covers `UnknownViewReopensRemembered` visually)
- Inventory desktop (browser + diagram + Battery doc): `Desktop` (covers `DocumentationTab`, `DetailPaneStacks`, `PanesOpenByDefault` visually)
- Inventory tabs/entities/modals/delete/style/protocols/docs: all other 23 Inventory stories (distinct)
- Score badge with score: `WithScore` (in `FullStrip` only as strip element; centered story kept)
- Tour 14 stops: each `Tour/Walk / <Step>` (distinct card)
- Backgrounds 1–4 (light, live app): `backgrounds.spec.ts` (untouched)
- Deleted port-less modal: no coverage (unrepresentable; delete-dialog empty-state reworded to "could not be resolved" per FINISHED task)

Viewports/themes/locales/edge cases preserved: `mobile1` stories (`Navbar MobileCollapsed/Expanded`, `Explore MobileManyDiagrams/MobileNoEmbed`, `Projects Mobile*`, `Diagnostics NarrowStrip`) untouched; `tablet`/`desktop` toolbar/viewport stories untouched; `dark+light` for all kept; `en-US` throughout; long-text/wrap (`LongErrorMessageWraps`, `MarkdownUnwrappedOverflows`), truncation, focus/selected/disabled/expanded (`SingleSelected`, `EmbedDiagramButton Disabled`, `NodeVisualStyles` selected outline, `Diagnostics Expanded`) untouched.

## 5. Summary

- Stories: 200 total. VRT stories **179 → 161** (−18). `no-vrt` 21 → 39.
- Snapshots: **364 → 326 files** (−38: 18 stories ×2 + 1 orphan story ×2). Unique bases 184 → 165 (161 story + 4 backgrounds).
- Tests: `just vrt` **362 → 326** (−36; 18 stories ×2). Post-change run: **326 passed, 0 changed, 0 new, 0 errors, 326 unchanged** (5.2m wall, fully parallel).
- Runtime: −10% test count; wall-time saving ≈10% (≈30s on this machine, more on slower CI runners). No new baselines needed (`just vrt-accept` not run; no `Showcase` stories added, no thresholds touched).
- Lint/type: `just lint-frontend` (eslint + svelte-check) clean; `just vrt` green. No `web/src` component code changed — only 9 story files + snapshots.

## 6. How to reproduce

```bash
git checkout test/vrt-dedup
just vrt  # 326 passed, gallery web/vrt-report/index.html
ls web/vrt/__screenshots__ | wc -l  # 326
```
