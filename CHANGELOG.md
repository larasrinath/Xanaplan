# Changelog

Record user-visible changes here; the README describes current setup and behavior.

## Unreleased

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
