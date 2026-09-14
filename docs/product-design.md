# Xanaplan local assistant

One person wears both hats. The Chrome side panel contains **Assistant** and **Admin** and stays beside Anaplan. There is no shared administration service in this version.

## Admin

Admin sections appear in this order: **AI access → Anaplan access → Enabled apps**, with **Add app** beside the enabled-app list.

AI access and Anaplan access start collapsed on each panel load. They expand when clicked; an explicit connection attempt can reveal Anaplan access when sign-in needs attention. An unavailable helper on initial load does not automatically expand the card.

Both card headers show a status dot beside the chevron, with a tooltip and screen-reader label: green for signed-in AI/connected Anaplan, amber when access needs attention, and gray when status is unavailable. AI access reflects the saved provider, even while another provider is being edited. AI sign-in status does not claim that an inference request or a particular model has been tested successfully.

Both access cards share heading typography and account-row layout, with an identical **Check connection** button aligned to the right (stacked at very narrow widths). AI login instructions appear only when sign-in is needed. OAuth client settings sit inside **Connection settings**; helper recovery appears only when unavailable. Save feedback, errors and required sign-in steps remain visible when relevant. AI **Save settings** is disabled when unchanged, and **Discard changes** appears only for an unsaved edit.

AI settings has two providers: **OpenAI** and **Claude**. Admin chooses a provider and an optional model name, tests with a synthetic request, and saves. The saved choice applies to all enabled Anaplan apps. Blank model means provider default. Existing installations retain Claude until Admin explicitly saves a different setting. Testing unsaved settings does not activate them.

The helper resolves provider/model from its local store. Request-level overrides and stale AI revisions are rejected. Settings cannot change during an active answer or connection test. A new AI revision starts separate conversations, avoiding automatic transfer of old-provider history. Provider failures never trigger a fallback to the other provider. This is local configuration by the same person, not a separate multi-user role system.

The setup sequence is **Sign in → Tenant → App → Automatically identify connected models → Set business context → Save & enable**. An administrator does not need to open the target app first. The local Chrome side panel is the setup interface.

Tenant discovery makes a background GET request to Anaplan's customer-list service. Admin chooses a tenant, and the extension requests that tenant's app catalog directly. No menu is rendered or clicked, and Anaplan's active tenant is not changed. The selected tenant must still be accessible to the current Chrome session. App ownership is checked before and after reading connected models.

Tenant and app dropdowns use a browser-local cache without time expiry or automatic eviction, scoped to Anaplan site and tenant. Existing caches survive the update. Add app still checks MCP access before showing tenants; a saved list avoids a discovery request. The tenant list is read in one request, and apps are discovered only for the chosen tenant. The single Refresh action updates the tenant list and then the chosen tenant's app catalog. It retains the current tenant/app selection when still available and preserves the context draft. If an app is selected, its models are rediscovered and verified. Other tenants' catalogs are not enumerated. Successful refreshes replace saved lists. On a temporary refresh failure, the panel shows the previous list with an inline explanation and its original update date. Cancellation preserves saved data but does not report success. Storage failures are surfaced when the browser cannot save a loaded list.

The **App** field opens a dropdown containing **Search apps** and a scrollable list of options. Search ignores case, accents and extra whitespace; every search word must match the name. A Clear control, match count and no-results state appear when relevant. Search makes no network requests and never changes the selected app or its draft context. Only clicking a result or pressing Enter on an active result changes the selection; arrow keys move the active result, while Escape closes without choosing. Enter with no matches cannot submit the form. Clicking outside or tabbing away closes the dropdown. Search resets on a tenant change or new Add app flow and is retained across Refresh. Already-enabled apps display their fixed selection while editing context.

**Search enabled apps** sits above the saved cards when at least one app is enabled. It filters by app and tenant name with the same word matching, a Clear action and a no-results state. Filtering affects only the visible cards; it leaves an open context editor, selected conversation app and conversation history unchanged.

One Refresh action sits in the app setup header. There are no separate field or connected-model refresh buttons. Successful list loads show no extra status paragraph. Loading, errors and failed-cache-refresh warnings stay inline. Business context has one compact **Import file** control and a short placeholder; file limits remain visible. Imported content stays editable until saved.

Failed responses, model membership, discovery tickets and credentials are not cached. New OAuth prompts, saved client-ID changes and browser authentication failures clear account-related caches. Model discovery and MCP verification stay live before enablement; cached labels never grant access. This local cache belongs to one Chrome profile, not a central or multi-user identity store.

Selecting an app requests the same page/model associations used by Anaplan's **Show models** action, including workspace names. Models repeated across pages are combined by ID; conflicting details are rejected. The helper resolves those workspace names and verifies every model ID through MCP before issuing a short-lived discovery ticket. Workspace discovery remains an internal implementation step; there is no workspace dropdown or workspace filter in setup. An app may use models across multiple accessible workspaces. Saving new membership requires a discovery ticket; raw model IDs cannot be submitted as new membership.

App identity and business context are keyed by Anaplan site, tenant ID and app ID. Workspace IDs are stored only on connected models for scoped MCP reads. Earlier workspace-based app entries remain readable and editable; refreshing tenant/model discovery can associate them with their tenant while retaining context. Ambiguous workspace names or incomplete model lists stop verification rather than guessing IDs.

Connected models are displayed as read-only model names and workspace details, without selection controls. All models returned by verified discovery are included when the app is saved. Business context is stored once per tenant and app, not per page or module. Existing app context can be edited offline using its saved models; **Refresh** in the editor header replaces those details with the current verified list for the next save. Removing an entry only disables it locally. Legacy model contexts are preserved in the settings file and are not automatically mapped to an app.

Context includes purpose, KPIs, definitions, currency/units, calendar, versions, assumptions and decision constraints. Supported context files: UTF-8 TXT, Markdown, CSV and JSON, up to 60 KB. These are text imports into the editor, not binary Anaplan model backups or a data-analysis upload pipeline. No module, card or UX-page mappings are required.

Each save increments a revision. Stale saves are rejected. New questions use the saved revision, and in-flight answers are rejected if context changes or the app is removed. Completed chats are saved locally and remain available after the panel or helper restarts. Continuation stays scoped to the same app/context, page/model/filter snapshot and AI-settings revision.

## Assistant

The app and page appear as two compact dropdowns. A single muted line shows confirmed page selection values when available, with inherited tab values labeled explicitly. The Assistant has no technical Context details section: card mappings, module IDs, provider metadata and repeated selector warnings remain behind the scenes. Explain a missing business selection in the answer only when it affects the question; loading and actionable connection errors remain visible. **History** and **New chat** sit above this context header. History is searchable by question, app and page and retains source details. Matching conversations resume; other contexts open for review without changing Anaplan. See [saved conversations](chat-history.md).

Select an enabled app and identify a page, then ask business questions: performance against budget, drivers of a change, priorities or tradeoffs. The helper verifies page modules, line items, dimensions and views, then exposes a scoped subset of its read tools. Formula tracing can expand access to verified referenced modules. The AI interprets retrieved evidence with saved business definitions and returns inspectable sources. Factual findings, calculations, hypotheses and recommendations must be distinguished.

The selected app is explicit. An already-open UX app can preselect a uniquely matching enabled app when the panel opens. **Follow current tab** then identifies the published board/worksheet and visible page/card selectors. A page dropdown pins chat context without navigating the browser. Manual pages label inherited/default selections. Explicit query overrides apply only to the answer, retaining other context. Ambiguous models require a choice; unresolved selections require investigation or clarification. Custom cards can provide underlying module evidence with explicit applied/pending filters. The assistant must establish business predicates and complete data coverage before claiming a count, and distinguish those findings from an exact reproduction of the displayed card. See [implemented coverage and live acceptance](page-assistant.md).

Each page-aware question pins one verified source model from the app's enabled models. The helper rejects another model and injects the selected workspace/model IDs. Evidence and sources identify the page, card, model, effective filters and any formula dependency path. Cross-model questions require a future explicit comparison flow; development/production alternatives are never combined automatically. Numerical correctness still requires live accuracy testing.

## Local architecture

See the [architecture guide](architecture.md) for current module ownership and refactoring boundaries.

Chrome side panel → paired HTTP helper on 127.0.0.1:8766 → the Admin-selected OpenAI/Codex or Claude/Claude Code connection for reasoning + existing anaplan-mcp subprocess for reads.

The helper uses the sibling MCP checkout without modifying it. It loads MCP schemas and calls only its explicit read allowlist. The AI never receives the broad MCP server as a direct tool connection. The helper inserts the chosen connected model/workspace IDs and rejects attempts to access any model outside the enabled app. Imports, exports, process runs, cell/list writes, and model administration tools are unavailable.

Both CLIs run unmodified with their own authentication. The extension does not implement provider OAuth or extract tokens. Subscription users sign in with `codex login` or `claude auth login`; each CLI also supports normal API authentication. Model overrides are passed as process arguments without a shell. Tests send only synthetic data.

Claude disables built-in tools, other MCP servers, hooks, skills, browser access and session persistence. Codex runs ephemeral in a temporary directory, ignores personal configuration, disables shell/browser/apps/plugins/MCP and other tool features, uses a read-only sandbox with no approvals, and stops unexpected tool-action events. The helper remains the only route to Anaplan reads. Verified CLI versions: Codex 0.154.0 and Claude Code 2.1.259; review adapters when upgrading.


The helper saves provider/model settings and revisions, enabled apps and connected model memberships, legacy model contexts, context revisions, an optional public Anaplan OAuth client ID, and a random pairing token in `.local/settings.json` with owner-only permissions. Generated `extension/local-config.js` pairs this extension with the helper. Neither file is committed. Model reads use the MCP's in-memory session; webpage cookies are not copied. Restarting or expiry can require Anaplan authorization again.

Settings and app-context save/removal paths share the same persistence operation. If writing settings fails, the previous in-memory snapshot remains active; a failed AI save does not switch the provider or advance its revision. Conversation files use a separate atomic write in `.local/conversations/`; saving an answer never rewrites provider settings or the pairing token.

The service binds only to loopback, checks the Host header and extension Origin when present, and requires the pairing token on every API request. It serves no webpage or local files. Questions and relevant context/data go to the user's configured AI connection when submitted; “local” describes setup and orchestration, not offline inference.

## Practical bounds

- Up to 10 MCP reads per question, cell reads capped at 1,000 rows. Partial/truncated reads are marked and must not support whole-model totals or rankings.
- Questions can take multiple CLI calls. Broad questions may need narrowing; this is an initial prototype, not a benchmarked business analytics product.
- One question at a time. Stop cancels the request and terminates active inference.
- Workspace/model lists show up to 1,000 matches. New app verification fails on incomplete lists; no partial enablement. App model lists are limited to 100 models.
- Business-answer accuracy requires user sign-in and verification against a live model.
- Shared hosting, organization roles, provisioning and centrally published context are deferred to `future-management.md`.

## References

- [Anaplan MCP source](https://github.com/larasrinath/anaplan-mcp)
- [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Claude Code authentication](https://code.claude.com/docs/en/authentication)
- [Claude Code programmatic usage](https://code.claude.com/docs/en/headless)
- [Claude Code credential use](https://code.claude.com/docs/en/legal-and-compliance)

- [OpenAI/Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)

## App discovery adapter limits

The adapter uses internal read-only web-service routes identified in Anaplan's public app-shell and Apps client bundles. It reads tenant IDs from the customer-list response, app IDs from the chosen tenant's catalog, and model IDs from page/model associations. No ID is guessed from names. [Request paths, evidence and verification limits](discovery-api.md) describe the contract.

The service worker accepts discovery messages only from this extension's panel. It uses GET requests with Chrome-managed session cookies and existing Anaplan host permissions. The manifest enables no offscreen document or discovery content script. Requests have deadlines; cancellation aborts pending requests, and late results cannot replace a newer selection. The panel shows its spinner throughout access checks, discovery and MCP verification. Discovery never opens, navigates or closes a page. Explicit user sign-in remains separate. No cookie or bearer-token values are extracted. Browser sign-in and the helper's MCP authorization remain separate; both must use an account with access to the same models.

The routes are **not a documented public Apps API** and may require maintenance when Anaplan changes its web services. Single-tenant accounts need no visible switcher, and empty catalogs are supported. Unknown schemas, indicated pagination/incomplete lists, inaccessible models and conflicting identities stop discovery. Up to 100 models are supported. Requests time out after 15 seconds and discovery after 55 seconds, with an inline error. The host defaults to `us1a.app.anaplan.com` or uses the active Anaplan tab's host. Public source inspection established the routes on that host; live credentialed extension access and other regional hosts still require testing.

Automated API fixtures and the synthetic panel harness verify route selection, parsing, loading, cancellation and tenant isolation. They do not establish real Chrome session compatibility or answer accuracy. The earlier iframe reader and its tests remain historical code and are no longer used by the extension manifest.
