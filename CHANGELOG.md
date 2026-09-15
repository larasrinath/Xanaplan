# Changelog

Record user-visible changes here; the README describes current setup and behavior.

## 0.9.3

- Add a complete setup guide covering local installation, AI sign-in, Chrome’s Anaplan sign-in, MCP authorization, the page menu, updates, troubleshooting and backups. Refresh the README, product behavior, history and live acceptance docs.
- Add an Anaplan affiliation and trademark disclaimer. Clarify OAuth-only model access, MCP rebuild order and post-update connection checks; remove temporary verification notes from the README.
- License Xanaplan under Apache 2.0 with the full license text, a completed copyright notice for Lara Srinath and matching package metadata.
- Add a NOTICE file, package authorship metadata and an Apache header on every source file, so attribution travels with the code when files are redistributed on their own.
- Rename the extension and panel title to “Xanaplan - Planning Assistant”, using a plain hyphen.
- Apply the supplied logo’s blue, lavender and cream palette subtly across Assistant, History, Admin, navigation, controls, chat bubbles and activity states. Keep surfaces nearly white and text dark.
- Keep answers running when the browser page, chat page or selections change. Retain the original verified context and conversation, show which page is being answered, and keep the completed answer visible with both continuation choices. Explicit Stop still cancels.
- Replace the boxed App/Page section with a compact page row and an on-demand menu for following the current tab, refreshing or choosing another app/page. Omit the generic “App & page” heading. The menu overlays the conversation, closes on selection, outside click or Escape, and retains accessible labels.
- Follow the current tab’s uniquely matched enabled app as well as its page, fixing mismatches between the selected app and the browser. Explicit manual and saved-context choices stay pinned until following is resumed.
- Use one composer action button: the send arrow switches to a square Stop icon while answering and returns after completion, cancellation or an error. Remove the separate answer Stop buttons.
- Recognize Anaplan’s `GRID-PAGE` catalog type as a worksheet. Previously these pages were incorrectly disabled as an unsupported type even though a worksheet reader exists.
- Reopen saved chats with unresolved selections while preserving those limitations. Known saved filters still require fresh verification; numeric reads that need an unknown selector still require clarification. Failed or cancelled restores leave the current page and continuation controls usable and show a single error.
- Use “What would you like to understand?” in the composer. Enter sends; Alt+Enter inserts a newline at the cursor. IME composition does not send. Remove page guidance from the chat box and show keyboard hints there; actionable chat errors appear outside it.
- Restart the helper and reload the extension to apply the saved-context fix and UI changes.

## 0.9.2

- Keep a time-of-day greeting and build starter questions from the verified page’s named cards and confirmed selections. Suggest comparisons between related cards; clear suggestions while a page loads or becomes unavailable. Choosing a starter fills an editable draft. No additional AI or Anaplan requests are made to generate suggestions.
- Use the supplied Xanaplan logo in the panel header, assistant avatars, favicon and Chrome extension icons. Preserve the original transparent PNG.
- Reload the extension to apply these display changes. A helper already running 0.9.1 does not need restarting.

## 0.9.1

- Add four answer activity stages with distinct animations, a current-stage indicator and plain-language operation labels. Stage changes follow real events, including repeated data reads; reduced-motion preferences disable animation.
- Show page-loading stages, elapsed time and Stop. Reuse recent page definitions for selector-only changes and use a model-wide saved-view catalog before checking the owning module, avoiding scans of unrelated modules.
- Offer both History choices: continue on the current page, or restore the saved page and selections after fresh access and membership checks. Preserve independent card filters and reject changed or unavailable saved contexts.
- Display “App & page” above an expanded picker and the page name when collapsed. Automatically collapse a picker opened for an error after recovery.
- Restart the helper and reload the extension. No additional permissions are needed.

## 0.9.0

- Show actual answer activity as it happens: AI-provider waits, Anaplan reads, formula checks, source preparation and saving. Include an elapsed timer, expandable operation log, connected-helper heartbeats and an inline Stop control. Report a dropped or stalled stream instead of waiting indefinitely without feedback.
- Reclaim vertical space with a hamburger menu for Assistant, History and Admin, a header New chat button, and an expandable page row. Keep the conversation scrolling separately above a bottom composer. Right-align user bubbles and render assistant answers with safe basic Markdown, tables and Copy answer.
- Let saved chats continue on the current verified page after an explicit Continue on this page action. Mark context changes, retain previous messages and sources, and require fresh evidence for follow-ups. Revision checks and current-page access restrictions still apply.
- Distinguish unsupported reports from unknown page types. Preserve the page list after either error so a supported board or worksheet can be selected.
- Add synthetic stream, cancellation, heartbeat, formatting, navigation and context-continuation coverage. Restart the helper and reload the extension to apply the update; no new extension permissions are required.

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
