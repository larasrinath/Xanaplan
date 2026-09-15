# Architecture

Xanaplan has two runtimes: a Chrome extension and a local Node.js helper. There is no build step or application framework. Keep this guide and the README aligned with changes to module ownership.

## Chrome extension

| Module | Responsibility |
| --- | --- |
| `extension/panel.js` | Coordinates Assistant/Admin state, app setup, settings, context drafts, and per-revision conversations. |
| `extension/welcome.mjs` | Builds local starter questions from verified page metadata and renders the greeting without additional network calls. |
| `extension/chat-history.mjs` | Loads saved conversations, restores matching threads, manages archive browsing/search and renders History controls. |
| `server/conversations.mjs` | Persists displayed messages and source snapshots in atomic, owner-only local files; validates conversation scope/revision and provides archive summaries. |
| `extension/panel.html`, `extension/panel.css` | Side-panel markup and styles. |
| `extension/local-api.mjs` | Sends paired HTTP requests to the helper and preserves structured errors and cancellation. |
| `extension/chat-stream.mjs`, `extension/question-progress.mjs` | Decode incremental chat events and render transient operation activity, elapsed time, connection state and Stop. |
| `extension/conversation-view.mjs` | Renders messages, model sources, and context labels using text nodes. |
| `extension/answer-markdown.mjs` | Renders a bounded Markdown subset using DOM nodes, without raw HTML, images or executable links. |
| `extension/searchable-select.mjs` | Search matching and keyboard-accessible app selection. |
| `extension/anaplan-auth.mjs` | Validates sign-in links and opens the explicit sign-in flow. |
| `extension/app-discovery.mjs` | Sends discovery jobs to the service worker and applies list caching. |
| `extension/discovery-input.mjs` | Validates the Anaplan origin, tenant, and app identifiers shared by discovery modules. |
| `extension/discovery-cache.mjs` | Stores tenant/app lists and guards against stale refresh results. |
| `extension/background.js`, `extension/discovery-background.mjs` | Opens the side panel and runs cancellable discovery jobs from verified panel callers. |
| `extension/discovery-api.mjs` | Makes background GET requests and validates tenant, app, and model responses. |
| `extension/page-api.mjs`, `extension/page-background.mjs` | Read published page catalogs/definitions and normalize card sources through authorized, cancellable background jobs. |
| `extension/page-observer.mjs` | Reads visible selector labels, page title, model name and card IDs in the existing Anaplan tab via an isolated, on-demand snapshot. |
| `extension/page-tracker.mjs`, `extension/page-panel.mjs` | Manage follow/manual/saved context, enabled-app matching, generation guards, pre-question observation, the compact page menu and polling/tab events. |

App discovery uses Chrome-managed Anaplan cookies and background GETs. Page context additionally observes specific controls in the already-open tab and its existing Springboard frame using `chrome.scripting`. It does not create frames, switch tenants, read storage/cookies, intercept requests or navigate tabs. Sign-in is a separate explicit action.

## Local helper

| Module | Responsibility |
| --- | --- |
| `server/index.mjs` | Resolves local configuration, creates the store and providers, binds loopback, generates pairing configuration, and handles shutdown. |
| `server/app.mjs` | Composes the API routes, operation locks, discovery tickets, and connection-reset state. Import `createApp` here in request tests. |
| `server/http.mjs` | Enforces pairing/Host/Origin checks, CORS, JSON body limits, and JSON responses. |
| `server/validation.mjs` | Defines application errors and shared required-text/identifier validation without importing storage. |
| `server/llm-settings.mjs` | Defines supported providers and validates provider/model choices for both testing and saving. |
| `server/store.mjs` | Persists app context, AI settings, connection settings, and legacy model context. |
| `server/apps.mjs` | Resolves and independently verifies all browser-discovered model memberships through MCP. |
| `server/chat.mjs` | Orchestrates bounded reads and answers using saved app/context revisions and source evidence. |
| `server/chat-progress.mjs` | Maps actual read operations to user-facing labels and writes opt-in NDJSON progress, heartbeat, result and error events. |
| `server/page-context.mjs`, `server/page-metadata.mjs` | Verify page source membership and selector IDs through MCP; parse its current table/view metadata with completeness checks. |
| `server/saved-page-context.mjs` | Loads authoritative saved page snapshots and checks restored source/filter identity before a new ticket is issued. |
| `server/page-scope.mjs` | Enforce page/module/view scope, apply validated filter overrides and trace bounded formula dependencies. |
| `server/providers.mjs` | Selects the saved provider, checks AI revisions, and runs synthetic connection tests. |
| `server/openai.mjs`, `server/claude.mjs` | Implement the existing provider CLI integrations. |
| `server/cli.mjs`, `server/llm-contract.mjs` | Share process execution, cancellation, and structured decision validation. |
| `server/mcp.mjs` | Connects to the sibling MCP server and enforces the read-tool allowlist and model scope. |

HTTP handling and domain modules can be imported without starting the helper, resolving local CLI credentials, or writing extension pairing configuration.

## Request flow

1. **Enable an app:** panel → discovery service worker → Anaplan GET responses → helper `/app-discovery` → MCP model verification → discovery ticket → helper `/apps` → local store.
2. **Identify context:** selected app + observed tab, manual page or saved chat → published page definitions → helper `/page-context` → MCP source/filter verification → five-minute context ticket. The route supports progress streaming. Every result is generation guarded. A recent definition can be reused for selector-only changes; explicit refresh fetches it again. Saved mode loads its filters from the helper’s conversation store and verifies them against the fresh page and MCP membership.
3. **Ask a question:** fresh tab observation → freeze verified context ticket → paired helper `/chat` → saved provider/revision → structured AI decision → page-scoped MCP reads / verified formula expansion → cited answer with effective filters → saved conversation. With `stream: true`, operation events arrive before the final result. A ten-second heartbeat confirms the helper is connected without claiming model progress. The client reports 45 seconds without stream data as a disconnected/stalled helper and cancels the response. Legacy JSON callers keep their existing contract.
4. **Save settings or context:** validate input/revision → prepare the next store snapshot → write and rename the settings file. A failed write restores the previous in-memory snapshot, so unsaved values never become the active choice.

App `/chat` requires a ticket bound to its app revision. The helper pins one verified page model. It exposes only page tools and rejects raw `pages`, exports and unrelated module/view reads. Formula expansion is lazy, limited to four levels and 25 modules, and records paths. Each answer has at most 10 AI read decisions, 1,000 rows per cell read and bounded evidence; metadata verification is separately bounded. Unknown or unsupported filters block cell reads while allowing an explanatory response. See [page context limits](page-assistant.md).

History uses a saved scope by default. An explicit `continueInCurrentContext: true` permits a saved conversation to move to the current verified scope on its next successful turn; merely viewing or preparing a continuation never changes its file. The original messages retain their sources/page snapshots, and the next user message records a context-change marker. The helper loads authoritative history from disk, warns the provider that earlier contexts are background rather than current evidence, and enforces all new reads through the current ticket and model. Scope changes still require current conversation and AI revisions. Saved restoration verifies an isolated candidate before replacing the active tracker context. Its original unresolved selectors survive restoration and ticket renewal; exact reads enforce missing selections and module evidence carries unresolved conditions until a verified explicit question override resolves them.

## Refactoring boundaries

- A running turn retains its own thread, verified page snapshot and request controller in `panel.js`. Page-tracker updates may refresh the next context but never abort that turn or redirect its result. Completion in a different context uses the existing archive continuation controls and preserves the original saved scope. Explicit Stop and panel closure still abort.
- Keep network calls out of view rendering and preserve the panel's cancellation and revision checks when moving stateful code.
- Keep authorization and membership checks in the helper even when the browser has already validated inputs.
- Retain legacy model storage and endpoints until there is an explicit migration plan for existing local data.
- The retired column-resize demo and iframe-discovery implementation are preserved in Git history before this refactor. Their tests were removed with those implementations; the active GET discovery tests remain.
- `.local/` and `extension/local-config.js` are generated local state and stay outside Git.

## Verification

After `npm ci`, `npm test` runs the Node tests using synthetic data. Request tests share `tests/http-client.mjs`, which invokes the real HTTP listener without binding a port. The DOM flow uses jsdom to run the real panel controller with isolated Chrome/MCP/AI adapters. Persistence tests cover failed writes and retries at the original revision.

`npm run check` checks JavaScript syntax, production module links, extension assets, matching package/manifest versions, and the discovery runtime constraints. It traverses the service-worker's static dependencies and rejects dynamic imports, which Chrome disallows in that runtime. The generated pairing module may be absent before the first `npm start`.

`npm run test:ui` serves the synthetic panel at `http://127.0.0.1:8768/`. Set `XANAPLAN_UI_PORT` to use another port. It uses production helper routes, isolated temporary settings, and synthetic MCP/AI/discovery adapters. The fixture controls simulate tab/selector changes and failures. Its asset allowlist excludes actual local configuration. It does not test live Anaplan, browser permission handling or AI behavior.
