# Background discovery, version 0.6.1

The former discovery adapter opened normal Anaplan tabs, then moved the same UI reader into an offscreen iframe. Live discovery stalled on the iframe's tenant-menu reader. Synthetic DOM tests did not establish that Anaplan rendered or authenticated equivalently in that frame. Version 0.6.0 removes that runtime dependency entirely.

The extension service worker makes authenticated GET requests to the data services used by Anaplan's own web clients. It does not open a page, render a menu, change the selected tenant, or require the target app to be open. Chrome attaches cookies using `credentials: include` and the existing Anaplan host permission. Cookie values are never read, copied to the local helper, or stored by Xanaplan. There is no cookie permission or content script.

Chrome documents a same-site exception for extension network requests with host permissions, subject to the browser's cookie settings. That supports this approach but does not establish the settings or session state in the user's development profile. [Chrome storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies).

## Evidence for the request adapter

On 2026-09-12, the unauthenticated public HTML for `/a/apps` and `/a/table-of-contents-toc-ui` identified these client bundles. They were inspected as text, not executed:

- [Anaplan app shell](https://us1a.app.anaplan.com/a/apps/assets/index-BhLlXpVf.js): the customer loader reads `/customers`, and the menu maps `customerGuid`, `customerName` and `selectedCustomer`.
- [Anaplan Apps client](https://us1a.app.anaplan.com/a/table-of-contents-toc-ui/assets/index-BxOGmvbf.js): the definition-service client exposes `getAppsWithCustomer`, `getAppV2` and `getModelsForApp`. Its Show models action combines each page's models and deduplicates by model ID.

All routes below are relative to the validated Anaplan regional origin. No caller-supplied arbitrary path or next-page URL is requested.

| Purpose | GET path | Fields used |
| --- | --- | --- |
| Accessible tenants | `/a/springboard-platform-gateway-service/customers` | `customers[].customerGuid`, `customerName`, `selectedCustomer` |
| Chosen tenant's apps | `/a/springboard-definition-service/customer/{tenantId}/apps` | `items[].guid`, `name`; check `customerId` if present |
| App ownership | `/a/springboard-definition-service/apps/{appId}?includeUnpublished=true&includeReportPages=true` | Required `customerId`; check `guid` if present; header `x-api-version: 2` |
| Connected models | `/a/springboard-definition-service/pagemodels/app/{appId}?includeReportPages=true&includeArchived=false` | `pages[].models[]`: `modelId`, `modelName`, `workspaceName` |

Other reads send `x-api-version: 1`. Anaplan's web client also sends diagnostic headers; no bearer token extraction is needed by that client. These are observed internal web-service contracts, **not a documented public Anaplan Apps API**. Changes to those contracts may require adapter maintenance. Public client code establishes routes and parsing, not successful credentialed access from this installed extension.

## Flow and checks

Loading tenants makes one request for the entire list. Choosing a tenant checks current tenant access and requests only that tenant's catalog. It does not scan every tenant's apps. A single tenant needs no visible switcher; an empty catalog is accepted and shown explicitly.

Model discovery checks current tenant access, verifies app ownership, reads model associations, and rechecks app ownership. Repeated model IDs across pages are combined only when their details agree. Incomplete, malformed, conflicting, or oversized responses fail without enabling an app. Up to 100 connected models are supported. The local helper independently resolves workspaces and verifies every model through MCP before issuing the existing save ticket.

Only the extension panel can start discovery. Cancellation aborts GETs and discards late results. Requests have a 15-second deadline, with a 55-second overall limit. Redirects and HTML sign-in responses do not get followed as data requests. HTTP authentication errors invalidate dropdown caches. Responses and raw network errors are not logged or included in user-facing diagnostics.

Tenant/app caches remain local indefinitely, without time expiry or automatic eviction. Refresh tenants updates only tenants; Refresh apps replaces only the chosen catalog after a successful read. Failed refreshes show the last saved list with its original date and an explicit fallback notice; cancellation and connection resets never become fallback successes. Model reads, MCP access and save tickets are always live. Browser sign-in and MCP OAuth remain separate. Authentication resets and explicit connection changes still clear cached account metadata.

## Verification boundary

Automated tests exercise the exact request routes/options, response parsing, tenant guards, duplicated page models, invalid/incomplete responses, login errors, size limits, cancellation, deadlines, cache invalidation and the helper's independent model verification. The UI harness uses the actual background service and parser with synthetic GET responses. The old iframe tests remain historical regressions; the manifest no longer loads that reader.

On 2026-09-12, all 60 automated tests and the syntax/manifest checks passed. The synthetic browser check verified tenant loading, an empty catalog, cached tenants/apps after panel reload, cancellation, fresh model discovery, two connected-model details without checkboxes, and saving context to enable the synthetic app. The harness replaces network responses and MCP verification; it makes no Anaplan or AI calls.

Version 0.6.1 passes 64 automated tests and syntax/manifest checks. Its cache tests advance the clock by 100 years, revisit more than 24 tenants, and cover explicit replacement, refresh failure, cancellation, storage failure and connection resets. The synthetic browser check at 320 px verified both collapsed cards, search matching and clearing, no-match feedback, preservation of the selected app and context, Enter without form submission, a failed refresh retaining its original dated list, and cached dropdowns after reloading during a simulated discovery outage.

Live credentialed requests and actual account response shapes still require verification in the development Chrome profile. The connected automation browser is the separate Codex in-app browser, not that Chrome profile. Reload Xanaplan 0.6.1 in the development profile and reopen its panel to activate the updated UI and cache behavior; an already-running local helper need not restart.
