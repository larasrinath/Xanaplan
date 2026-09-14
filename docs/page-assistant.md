# Page-aware Assistant · 0.8.2

Implemented locally; live Anaplan acceptance is in progress. Synthetic fixtures are illustrative contracts, not captured customer data.

The first live issue, reported on 2026-09-13, was Chrome rejecting a dynamic import in the page observer's service-worker path. Version 0.7.1 replaces it with a static import and checks every background dependency for this restriction. Node/DOM tests had allowed the import and did not reproduce that platform rule. [Chrome documents this restriction](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics#import-scripts). Reload the unpacked extension and reopen its side panel to apply the patch; successful live page discovery still needs confirmation.

The next live issue was the older Node helper still running without `/page-context`, returning a generic 404 after successful page discovery. The helper was restarted with the current code, saved apps remained available, and the route was verified with a deliberately stale revision that stops before any external read. Version 0.7.2 gives explicit helper-restart instructions for this mismatch. Full live source/selector acceptance remains in progress.

Live feedback then confirmed page/model discovery and three identified modules on “2000 - Store Placeholder Creation,” but a question counting existing stores with Store Size = Medium was refused because the card uses a custom view. Version 0.7.3 removes that blanket restriction by adding `read_module_cells`: it verifies module/view ownership, applies known page-axis selections, and returns other context as pending conditions to evaluate against evidence. Published query metadata is retained within a 16,000-character per-source / 40,000-character per-page limit; omitted metadata is explicit. Exact custom-card reproduction remains unavailable. The assistant must investigate existing-store membership, size, selected country, hierarchy level and complete coverage before counting. See the [updated discussion plan](assistant-flow-review.md#1-use-verified-modules-to-investigate-custom-card-questions).

## Behavior

1. Enable an app in Admin, then select it in Assistant.
2. Follow the active tab's published board/worksheet automatically. Page selection never switches the enabled app behind the user's back; a different app/tab prompts for a matching page.
3. The page dropdown changes only chat context. It remains pinned until **Follow current tab** is selected. A manual page uses same-model inherited page selectors when available, otherwise its published defaults; independent card defaults retain their own scope.
4. Use captured page/card selectors when the question omits those dimensions. Resolve names with direct lookup, then bounded verified-view members and dimension members if needed; never choose the first matching child or accept duplicates/incomplete metadata. Fixed hidden line-item choices are accepted only after verifying membership in their explicitly scoped module. Show compact app/page names and confirmed shared page selection values. Label inherited tab values explicitly; omit unknown, independent card and technical diagnostics from the start page. Keep verified modules, observed page/card selections, inherited selections, page defaults and question overrides in the internal context for answering. Unknown selections stay unknown. Multiple possible source models require an explicit chat model choice.
5. Before sending a question, re-observe the tab and freeze the verified context. A tab/context change cancels stale work. Histories are separated by app revision, AI revision, page, model and filters; matching saved conversations restore after a panel/helper restart. History also permits review of other contexts without browser navigation. See [saved conversations](chat-history.md).
6. Start with page modules. Follow a relevant line-item formula to access referenced modules, including SUM/LOOKUP mapping references. Subsequent traversal is restricted to returned line-item IDs. Maximum depth: four; module count: 25. Cycles do not recurse automatically. Missing, inaccessible, ambiguous or unsupported references are not guessed.
7. For an explicit item in the question, resolve the requested dimension/item through MCP and override that dimension for that read. Other applicable defaults remain. Relative dates that cannot be matched safely require clarification. The browser's selectors never change.
8. Answers carry a page/model snapshot; individual sources carry effective filters and dependency paths. Evidence and row limits remain visible.

## Supported and limited reads

| Case | Current behavior |
| --- | --- |
| Published boards and worksheet main grid/insight cards | Discover sources from published definitions. Verify module/saved-view membership through MCP. |
| Saved/default views with single-item page-axis selectors | Resolve visible labels to unique MCP item IDs; apply independent source-specific filters. |
| Unknown selector or model | Investigate captured labels using view/dimension members before clarification; do not guess a member. Ambiguous models still require selection. |
| Explicit period/version/entity name in question | Apply a validated override only to that dimension; cite effective filters. |
| Custom ADQ/view-description sources | Verify module IDs, retain query metadata and selections, and allow underlying module evidence reads. Card membership must be established from evidence. |
| Runtime filtering/pivot-enabled cards | Module investigation is available; claims about exactly displayed rows still require verified runtime state. |
| Scoped, branch-sync, advanced or multi-select context | Keep unresolved conditions explicit. No arbitrary page-axis defaults; investigate business predicates before asking for clarification. |
| Context that needs row/column-axis filtering | Module reads return these as pending conditions; MCP `read_cells.pages` only applies page dimensions. The assistant must verify and evaluate pending conditions against data. |
| Line-item cards | Apply verified fixed hidden line-item choices when Line Items is on the page axis; retain off-axis choices as pending conditions. Direct line-item card reproduction still requires a supported axis or future cell-coordinate support. |
| Reports, edit/draft pages, unknown definitions | Unsupported; select a published board or worksheet. |
| Large metadata catalogs | Bounded verification stops with a limitation. Finding a saved-view owner may require scanning module view lists. |

These are material coverage limits. This release establishes a guarded page-aware path, not full fidelity for every Anaplan UX page. Do not treat synthetic success as live answer acceptance.

## Contract evidence

The adapter was built from Anaplan's public, unauthenticated JavaScript assets, read as text on 2026-09-12:

- [Table of contents client](https://us1a.app.anaplan.com/a/table-of-contents-toc-ui/assets/index-BxOGmvbf.js): app response `guid`, `customerId`, `pages`, and page `identifier`, `name`, `pageType`, `appGuid`, `hasPublishedVersion`.
- [Springboard client](https://us1a.app.anaplan.com/a/springboard-ui/assets/index-CD712q3N.js): published `boards/{id}` / `grid-pages/{id}` GETs under `/a/springboard-definition-service`; `pageGuid`, `appGuid`, `customerId`, `modelInfos`, `contextOptions`; board widget maps and worksheet `widgetDefinition` entries; `dataSourceId`, `widgetDataSources`, `dataSourceType`, `axisDescriptionQuery`, `fields`, and `dataConfig`.
- The same client renders `model-select-name`, `inline-page-title__title`, `widget-wrapper-{clientGuid}`, `page-level-context-selector`, `{type}-context-filter-{dimensionId}[-{scope}]-button`, and `data-selected-label`. The observer reads these targeted controls only. It does not scrape cell values, storage, cookies or React state.
- [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting) documents the permission, isolated function snapshots and existing-frame results.

These internal web contracts can change. Live account response shapes and all selector variants still need confirmation. MCP handlers were checked in the sibling `anaplan-mcp/src/tools/exploration.ts` and `transactional.ts`; table parsing rejects incomplete or ambiguous metadata.

## Local validation

Latest local result: **121 tests passed**. The custom-card tests cover verified module reads, independent and inherited selectors, off-axis Country conditions, explicit overrides, formula dependencies, access limits, omitted query metadata and partial results. A scripted provider exercises the production request listeners from app discovery through a count sourced from module data, excluding placeholders, other countries, duplicate stores and summary rows. This validates the tool/evidence path, not a live model's reasoning accuracy or the customer's store count. The running synthetic harness previously completed app enablement → page verification → a February query override → a sourced answer over loopback HTTP. Native visual testing was attempted but remained blocked by pending Accessibility/Screen Recording permissions; the automated suite makes no live Anaplan or AI calls.

A separate OpenAI-provider check on 2026-09-13 used only synthetic store metadata/data through the actual `answerQuestion` loop and Codex provider. The provider investigated module metadata, invoked `read_module_cells` and returned the expected two distinct existing Medium stores in Canada/Actual, explicitly excluding the duplicate, placeholder, USA store and summary row. This is a model-behavior check on a fixture, not the live customer's count.

Run `npm ci`, `npm test`, and `npm run check`. The page tests cover URL/ownership checks, published-only discovery, saved-view verification, model ambiguity, independent selections, missing/duplicate filters, overrides, module gates, formula references/cycles, stale discovery, ticket enforcement, connection resets, and the app-to-answer route flow.

The jsdom tests also run the actual panel controller: startup, context display, asking, source rendering, chat-only page selection, history restoration and stale-answer cancellation. They do not test visual layout. `npm run test:ui` provides a browser harness with production helper routes and synthetic adapters; `/` exposes fixture controls. All settings are temporary and removed when the harness exits.

Version 0.8.2 adds a synthetic customer hierarchy fixture where direct name lookup misses the visible parent but view metadata resolves it. The production page-context → chat flow reads that parent and the verified hidden line item without asking for an account in the question. Regressions retain duplicate-name, incomplete-metadata, access, cancellation, advanced-filter and wrong-module checks. The reported live selection still requires a connected MCP session for validation.

A separate check used the actual OpenAI provider with this synthetic fixture through `answerQuestion`. It inspected line items and view dimensions, called `read_module_cells` with the captured parent customer, and answered **48 units** for ExampleMart / Herbal shampoo L / 1 Jan 24 without asking for a child account. This validates behavior on the fixture; 48 is not a value from the user's Anaplan model.

The fallback uses the existing MCP read-only tools and the [Anaplan view-dimension member endpoint](https://help.anaplan.com/retrieve-selected-items-in-a-dimension-70aa5711-b17b-4bd4-a565-620fde5d9826). Returned view members establish available IDs; they do not prove which browser item is currently selected. The observed label remains the selection source.

Version 0.8.1 additionally passed a headless Chrome visual check of the production panel with synthetic adapters at 320 px and 390 px. Both widths fit without horizontal overflow. Confirmed page values appeared once, independent card values were excluded, unknown selections hid the summary, and no browser runtime errors occurred. The diagnostic Context details section is absent. These checks do not use live Anaplan data.

## Next-session live acceptance

Restart the helper and reload the unpacked extension so 0.8.2 is active. Use a read-only test app with known totals.

1. Confirm tenant/app enablement and available page names; check the actual catalog and board/worksheet response contracts without retaining credentials or customer values in Git.
2. Open a saved-view board. Compare detected page, source model, module/view ownership, period/version/entity and independent card selections with Anaplan.
3. Switch pages via the Anaplan tab, then via the chat dropdown. Verify that only the first navigates and that **Follow current tab** resumes tracking.
4. Change period/version while idle and during an answer; ensure the previous answer cannot arrive under the new context.
5. Ask for a known KPI, then name another period/version in the query. Check cell values and source filters against Anaplan, and confirm browser selectors are unchanged.
6. Ask a driver question whose formula references another module and a SUM/LOOKUP mapping. Check the cited path and compatible dimensions; unrelated modules must remain inaccessible.
7. Ask the Existing Stores / Medium question on the custom card. Confirm metadata and module data are investigated, Canada and the existing-store rule are preserved, and the count matches a known complete result. Exercise duplicate display names, hidden/independent selectors, alternative models and runtime filters. Unresolved conditions must be explained specifically rather than refusing merely because the card is custom.
8. Test expired browser/MCP sign-in, unavailable helper, missing page access and large catalogs. Record actionable recovery and latency.
9. Inspect panel widths around 320–400 px, keyboard selection, focus, long names, loading states, sources and Stop. Native visual acceptance remains outstanding until browser control is available.

Record observed schema differences, unsupported card types and first-answer latency before deciding the next implementation slice in the [discussion plan](assistant-flow-review.md).
