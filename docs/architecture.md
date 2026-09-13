# Architecture

Xanaplan has two runtimes: a Chrome extension and a local Node.js helper. There is no build step or application framework. Keep this guide and the README aligned with changes to module ownership.

## Chrome extension

| Module | Responsibility |
| --- | --- |
| `extension/panel.js` | Coordinates Assistant/Admin state, app setup, settings, context drafts, and per-revision conversations. |
| `extension/panel.html`, `extension/panel.css` | Side-panel markup and styles. |
| `extension/local-api.mjs` | Sends paired HTTP requests to the helper and preserves structured errors and cancellation. |
| `extension/conversation-view.mjs` | Renders messages, model sources, and context labels using text nodes. |
| `extension/searchable-select.mjs` | Search matching and keyboard-accessible app selection. |
| `extension/anaplan-auth.mjs` | Validates sign-in links and opens the explicit sign-in flow. |
| `extension/app-discovery.mjs` | Sends discovery jobs to the service worker and applies list caching. |
| `extension/discovery-input.mjs` | Validates the Anaplan origin, tenant, and app identifiers shared by discovery modules. |
| `extension/discovery-cache.mjs` | Stores tenant/app lists and guards against stale refresh results. |
| `extension/background.js`, `extension/discovery-background.mjs` | Opens the side panel and runs cancellable discovery jobs from verified panel callers. |
| `extension/discovery-api.mjs` | Makes background GET requests and validates tenant, app, and model responses. |

Discovery uses Chrome-managed Anaplan cookies. It does not load hidden frames, inspect the page DOM, switch the active tenant, or open discovery tabs. Sign-in is a separate explicit action.

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
| `server/providers.mjs` | Selects the saved provider, checks AI revisions, and runs synthetic connection tests. |
| `server/openai.mjs`, `server/claude.mjs` | Implement the existing provider CLI integrations. |
| `server/cli.mjs`, `server/llm-contract.mjs` | Share process execution, cancellation, and structured decision validation. |
| `server/mcp.mjs` | Connects to the sibling MCP server and enforces the read-tool allowlist and model scope. |

HTTP handling and domain modules can be imported without starting the helper, resolving local CLI credentials, or writing extension pairing configuration.

## Request flow

1. **Enable an app:** panel → discovery service worker → Anaplan GET responses → helper `/app-discovery` → MCP model verification → discovery ticket → helper `/apps` → local store.
2. **Ask a question:** panel → paired helper `/chat` → saved provider/revision → structured AI decision → scoped MCP reads → cited answer → conversation view.
3. **Save settings or context:** validate input/revision → prepare the next store snapshot → write and rename the settings file. A failed write restores the previous in-memory snapshot, so unsaved values never become the active choice.

## Refactoring boundaries

- Keep network calls out of view rendering and preserve the panel's cancellation and revision checks when moving stateful code.
- Keep authorization and membership checks in the helper even when the browser has already validated inputs.
- Retain legacy model storage and endpoints until there is an explicit migration plan for existing local data.
- The retired column-resize demo and iframe-discovery implementation are preserved in Git history before this refactor. Their tests were removed with those implementations; the active GET discovery tests remain.
- `.local/` and `extension/local-config.js` are generated local state and stay outside Git.

## Verification

`npm test` runs the Node tests using synthetic data. Request tests share `tests/http-client.mjs`, which invokes the real HTTP listener without binding a port. Persistence tests cover failed writes and retries at the original revision.

`npm run check` checks JavaScript syntax, production module links, extension assets, matching package/manifest versions, and the discovery runtime constraints. The generated pairing module may be absent before the first `npm start`.

`npm run test:ui` serves the synthetic panel at `http://127.0.0.1:8768/panel.html`. Set `XANAPLAN_UI_PORT` to use another port. The harness serves an explicit asset list and synthetic API/discovery responses; add new browser modules to its asset list when extracting them. It does not test live Anaplan or AI behavior.
