# Changelog

Record user-visible changes here; the README describes current setup and behavior.

## 0.8.2

- Use captured page/card selections when a question leaves its customer, period or other context implicit. Investigate the selected parent member before asking the user to choose a child account.
- Resolve selection names through bounded view-member and dimension-member fallbacks when direct lookup returns no match. Reject ambiguous, incomplete and inaccessible metadata; preserve independent card selections and explicit query overrides.
- Verify fixed hidden line-item defaults against their source module instead of treating their module scope as an unknown business filter. Advanced or mismatched selections remain unresolved.
- Add regression coverage for omitted customer context through the production page-context and chat routes.

## 0.8.1

- Remove the technical Context details section from Assistant. Keep compact app/page names and one muted line of confirmed page selection values; label inherited values explicitly.
- Keep module mappings, card warnings and unresolved selectors in the internal answer context without displaying the diagnostic list to business users.
- Simplify loading and composer copy; retain actionable connection errors and saved chat history.

## 0.8.0

- Save completed chats locally with their sources and page context. Add searchable History, New chat, deletion, and automatic restoration after panel/helper restart.
- Resume conversations only within matching app/page/filter/AI context; open other contexts for review without navigating Anaplan. Saved history remains viewable after app removal.
- Replace the large app/page cards with two compact dropdowns. Move provider, tenant, module and filter information behind Context details; keep actionable errors visible.
- Validate conversation revisions, use atomic owner-only files, preserve damaged records, and keep answers visible if saving fails.
- Verify persistence, archive browsing and scope isolation in automated tests; inspect the compact header and History in headless Chrome at 320/390 px and verify reload restoration with synthetic data.

## 0.7.3

- Allow custom-card questions to investigate verified underlying modules through a separate read-only module-evidence tool. Preserve bounded published query metadata, verified module names and page/card selections.
- Apply known page-axis filters and explicitly return other selectors for evaluation against the data. Keep exact-card reads separate, preserve module/view ownership checks, and flag truncated or row-limited module responses.
- Guide the assistant to resolve business predicates and complete coverage before counting, instead of refusing solely because a card uses a custom view.
- Ignore non-data identifiers on decorative/action cards and treat empty filter/selection collections as ordinary context metadata.
- Add custom-card adapter, scope and full chat-flow regression tests with placeholders, other countries, duplicate/summary rows, formula references and incomplete results. Live Anaplan count acceptance remains pending.

## 0.7.2

- Explain when an older running helper lacks the page-context endpoint, with restart instructions instead of the generic “Not found” error. Preserve actual missing-app errors.
- The complete page-aware update requires both a helper restart and an extension reload; reloading the extension alone cannot update the running Node process.

## 0.7.1

- Fix page detection failing in Chrome with “import() is disallowed on ServiceWorkerGlobalScope” by loading the page URL parser through a static service-worker import.
- Check the full background module dependency tree for unsupported dynamic imports, and exercise the real observer through the background message handler in local tests.
- Reload the unpacked extension and reopen its panel to apply this fix; the helper does not need a restart for this patch.

## 0.7.0

- Identify published board/worksheet pages from the active tab and offer a chat-only page picker with explicit return to following the tab.
- Verify card modules and saved views through MCP, retain separate page/card selections, and show the selected model and filter provenance.
- Apply explicit question overrides without changing browser selections; trace bounded, verified formula dependencies before accessing another module.
- Bind app chat to expiring page-context tickets. Freeze each question's context, isolate histories, and cancel stale answers and discovery results.
- Surface unsupported custom views, advanced selectors and row/column context instead of substituting broader cell reads. Live adapter acceptance remains pending.
- Add synthetic API and DOM end-to-end tests. The UI harness now uses production helper routes with temporary settings.

### Included refactor

- Remove the unused column-resize prototype, demo, and hidden-frame discovery implementation. The active extension continues to use background GET discovery.
- Separate helper startup, HTTP handling, validation, and storage responsibilities; extract the panel HTTP client and conversation view.
- Use one validation path for saved and tested AI settings.
- Restore the previous in-memory settings after any failed save or removal, including AI settings and legacy model context.
- Expand checks for module links, extension assets, matching versions, request boundaries, and persistence failures.

## 0.6.6

Version 0.6.6 replaces the separate refresh controls with one **Refresh** in the app setup header. It refreshes tenants, the selected tenant's apps, and any selected app's connected models. Existing selections and draft context are retained when the selections remain available. When editing an enabled app, it refreshes that app's connected models.

## 0.6.5

Version 0.6.5 moves **Search apps** inside the App dropdown. Open the field to search and choose with the mouse or arrow keys and Enter; Escape closes it without changing the selection. A separate **Search enabled apps** field filters saved cards by app or tenant name. Both searches run locally and preserve context drafts.

## 0.6.4

Version 0.6.4 applies the same cleanup to **Enable an app**: Refresh actions beside their fields, search grouped with App, a compact **Import file** control and shorter context guidance. Normal cache timestamps move into Refresh tooltips; loading, errors and failed-refresh warnings remain inline. Cache lifetime and access checks are unchanged.

## 0.6.3

Version 0.6.3 gives both access cards matching headings, account rows, status dots and **Check connection** buttons. Setup guidance appears only when needed, and OAuth configuration is under **Connection settings**. AI changes show **Discard changes** and enable **Save settings**; unchanged settings keep Save disabled.

## 0.6.1

Version 0.6.1 starts both access cards collapsed and adds **Search apps** above the app dropdown. Search filters loaded names immediately, with a match count and Clear control. It keeps the current app selection and context while you search, and resets when you choose another tenant.

## 0.6.0

Version 0.6.0 replaces the failing offscreen tenant-menu reader with background GET requests for tenants, apps and connected models. The manifest no longer enables offscreen documents or content scripts. App ownership is checked before and after reading model associations, and the helper still verifies model access through MCP. Single-tenant accounts and empty catalogs are supported without UI scraping.
