# Xanaplan · Business Assistant

A local Chrome extension for business questions alongside Anaplan. One person switches between **Assistant** and **Admin**, enables apps, and maintains business context across their connected models. Anaplan access is read-only.

This README is a living document: update it alongside changes to setup, behavior, configuration, and verification. It describes the current implementation; proposed work lives in the linked design documents.

## Current status

- **Version:** 0.8.2, recorded in [package.json](package.json) and the [extension manifest](extension/manifest.json).
- **Delivery:** a locally loaded Chrome side-panel extension and a local Node.js helper, for one person using both Assistant and Admin.
- **AI connections:** OpenAI through Codex CLI or Claude through Claude Code, selected by Admin.
- **Validation boundary:** automated and synthetic checks are available; live Anaplan discovery and business-answer accuracy still require verification with a signed-in account.
- **Deferred:** shared administration, separate user accounts, and hosted deployment. See [future shared administration](docs/future-management.md).

## Start locally

Requires Chrome 116+, Node.js 22+, Codex CLI 0.154.0+ for OpenAI or Claude Code 2.1.259+ for Claude, and a built [anaplan-mcp](https://github.com/larasrinath/anaplan-mcp) checkout beside this project. The helper reuses that checkout's MCP SDK and compiled server; it has no separate npm dependencies.

Clone this private repository with a GitHub account that has access, or use your existing checkout:

```sh
git clone https://github.com/larasrinath/Xanaplan.git
cd Xanaplan
```

1. Sign in through the chosen official CLI: `codex login` for OpenAI or `claude auth login` for Claude. Supported subscription sign-in works; an API key is not mandatory. Each CLI also supports its normal API authentication. Your selected connection governs usage.
2. In this project, run `npm start` and leave it running. This generates the local extension pairing file.
3. Open `chrome://extensions` in **Google Chrome**, enable **Developer mode**, choose **Load unpacked**, and select this project's **extension** folder. If an earlier Xanaplan extension is loaded, choose **Reload**.
4. Sign in to Anaplan in Chrome and click **Xanaplan** in the extensions toolbar. It opens in Chrome’s side panel. You do not need to open the target UX app first.
5. In **Admin → AI access**, choose **OpenAI** or **Claude**, enter an optional **Model**, then **Check connection** and **Save settings** if you changed the saved choice. Blank model means provider default. This saved choice applies to all enabled Anaplan apps. Testing an unsaved choice does not activate it. Existing installations retain Claude until Admin saves a different choice.
6. In **Admin**, select **Add app**. Complete Anaplan authorization when prompted, then **Check connection**. Choose **Tenant → App**. The extension identifies connected models and the helper verifies access. Models are shown as read-only details and included automatically. Add business context and select **Save & enable**.
7. Switch to **Assistant** and select the enabled app. **Follow current tab** identifies its published page. Alternatively, choose a page for chat; this does not navigate Anaplan. Check the displayed model, modules and selections, then ask a question. If the active model is ambiguous, choose the source model for chat.

For this update, restart the helper and reload the unpacked extension. The extension now requests `scripting` permission for a short, read-only snapshot of visible Anaplan selector controls; it installs no persistent content script.

Anaplan webpage sign-in and MCP authorization are separate. The helper detects the public Anaplan OAuth client ID from `ANAPLAN_CLIENT_ID` or the Anaplan section of your local Codex MCP configuration. Otherwise, enter it in **Admin → Anaplan access → Connection settings**. AI sign-in is separate too; the extension never asks you to paste a subscription token.

If the MCP checkout is elsewhere, set `XANAPLAN_MCP_DIR` to its absolute path before `npm start`. Build it using `npm install` and `npm run build` in that checkout if needed. `XANAPLAN_CLAUDE_COMMAND` and `XANAPLAN_CODEX_COMMAND` can point to your installed CLIs. No cloud deployment is needed.

## Included

- Tenant, app and connected-model discovery through background GET requests, with an inline loading spinner and MCP access verification. No discovery pages or frames are created.
- Local enabled-app list, context editing, revision checks, and removal from the assistant.
- Optional UTF-8 TXT, Markdown, CSV or JSON context import, up to 60 KB. Binary model backups, PDF and Word files are not yet supported.
- Admin-managed OpenAI or Claude settings, with saved provider/model enforcement and no automatic fallback.
- Business Q&A through the saved AI connection and a page-scoped subset of the MCP read tools. Sources show the page, card, model, effective filters, reads, times and row limits.
- Server-enforced read-only access and enabled-app model scope. No exports, imports, process runs, cell writes or list changes.
- Save completed conversations locally and reopen them through searchable **History**. **New chat** preserves previous chats. Matching app/page/filter/AI context can resume; other contexts open for review without navigating Anaplan. Stop or a context change cancels inference.

The Assistant starts with the page's verified modules and follows relevant formula references into other modules when needed. Page and independent card selectors stay separate. Ask for an explicit period, version or entity by name to override that dimension for one answer; other defaults are retained. Manually selected pages label inherited selections and published defaults instead of calling them live selections.

The adapter supports published boards and worksheets. Saved/default cards with single-item page dimensions can be read directly. Custom cards can supply verified underlying module data: the assistant inspects their query metadata, line items and formulas, preserves selected context, and verifies business predicates before answering. Source details distinguish applied filters from conditions that must be evaluated against the data. Advanced/multi-select/scoped filters, runtime pivots and some line-item cards still lack exact reproduction; unresolved conditions or incomplete data cannot establish a card total. Reports are unavailable. See [page context and live acceptance](docs/page-assistant.md) and the [flow review and discussion plan](docs/assistant-flow-review.md).

App discovery uses the data services called by Anaplan's own web clients. A single GET loads accessible tenants; the selected tenant's apps are then requested directly. Choosing a tenant does not change Anaplan's active tenant or open a page. Workspaces are resolved automatically from connected models; there is no workspace setup step or workspace filter.

The adapter uses internal web-service contracts observed in Anaplan's public client bundles, not a documented public Apps API. It may need updating if those contracts change. Chrome attaches session cookies; Xanaplan does not extract them. Incomplete lists, ambiguous workspace names and inaccessible models block enablement. See [request evidence and verification limits](docs/discovery-api.md).

## Recent changes

Version 0.8.2 uses captured page selections for context omitted from a question, checks view members when direct name lookup fails, and verifies fixed hidden line-item choices. The Assistant stays focused on compact app/page names and a single line of confirmed page selection values. Technical context details stay behind the scenes. [Saved chat history](docs/chat-history.md) lets you search and reopen earlier conversations. See the [changelog](CHANGELOG.md) for version history.

## Data and local state

Tenant/app lists stay saved locally with no time expiry or automatic eviction. A failed refresh keeps the previous list and displays its original update date. Explicit connection changes and authentication resets clear account-related lists. Page definitions and verified context are transient: page verification expires after five minutes and is refreshed before another question. Earlier app contexts and dropdown caches remain available. Live credentialed requests and business-answer accuracy still need verification in the installed Chrome profile.

Settings and context live in `.local/`. Generated `extension/local-config.js` contains a local pairing token. Both are ignored by Git; do not share them or serve the project folder with a generic web server. The helper serves APIs only on 127.0.0.1 and checks pairing, Host and Origin.

AI processing is remote: questions, context and relevant Anaplan results go through the AI connection saved by Admin. Assistant displays the active provider/model and has no provider picker. This remains one person wearing two hats; separate user accounts and organization roles are deferred. Xanaplan does not save chats after the panel closes; app context is saved locally.

## Project layout

| Path | Purpose |
| --- | --- |
| [extension/](extension/) | Chrome extension, side-panel UI, and Anaplan discovery. |
| [server/](server/) | Local API helper, app/context storage, AI providers, and MCP access. |
| [tests/](tests/) | Automated tests and the synthetic UI harness. |
| [scripts/](scripts/) | Syntax, module-link, extension-asset, and version checks. |
| [docs/](docs/) | Architecture, product design, discovery evidence, theme, and future plans. |

See the [architecture guide](docs/architecture.md) for module responsibilities and the request flow.

## Verification

```sh
npm ci
npm test
npm run check
```

Tests require Node.js 22.22.2+, 24.15.0+, or 26+ and install jsdom as a development-only dependency. The production helper still has no npm runtime dependencies. DOM tests execute the real panel controller with synthetic Chrome/MCP/AI adapters and isolated temporary settings; they do not claim visual rendering or live browser acceptance.

`npm run test:ui` runs an explicitly synthetic UI harness. It never connects to Anaplan or an AI provider and is not the extension install path.

Tests cover persistence rollback after failed writes, the paired HTTP request boundary, panel API errors and cancellation, app persistence, multi-model source routing, verified discovery tickets, stale revisions, and discovery cancellation, plus the read-only gate, cross-model rejection, persistence/revisions, pairing/origin checks, authorization link validation, sources, truncation and cancellation. Additional tests cover provider/model enforcement, stale AI settings, connection-test isolation and cancellation.

Earlier verification included a real MCP handshake, synthetic requests through local OpenAI and Claude subscription connections, and browser checks for setup, saving/editing context, revision changes, duplicate app selection, questions, answers, and sources. Rerun the synthetic browser flows after frontend changes. Live answer accuracy still requires Anaplan sign-in, installation in Chrome, and testing your selected app.

The retired column-resize and iframe-discovery prototypes are available in Git history. Legacy saved model contexts remain supported; this cleanup does not migrate or delete local settings. Shared administration and hosting remain deferred.

## Documentation

- [Architecture guide](docs/architecture.md): module responsibilities, request flow, and refactoring boundaries.
- [Changelog](CHANGELOG.md): unreleased changes and version history.
- [Current product design](docs/product-design.md): Assistant and Admin flows, architecture, and practical bounds.
- [Discovery API evidence](docs/discovery-api.md): request contracts, access checks, and verification limits.
- [Page assistant](docs/page-assistant.md): implemented context rules, adapter evidence, limits, and tomorrow's live test cases.
- [Assistant flow review](docs/assistant-flow-review.md): end-to-end assessment and proposed changes to discuss.
- [Visual theme](docs/theme.md): interface styling guidance.
- [Future shared administration](docs/future-management.md): proposed requirements and open decisions for a later hosted version.

## Keeping this document current

Update this README in the same commit as any change that affects installation, UI flows, supported behavior, configuration, or data handling. Keep the version above aligned with the package and extension manifest when releasing, and add a concise entry to `CHANGELOG.md` for user-visible updates. Keep the project layout and architecture guide aligned with file moves and removals.

Keep implemented features, known limitations, and future plans distinct. When reporting verification, say whether it used automated tests, synthetic fixtures, or a live signed-in Anaplan account; do not treat one as evidence for another. Put detailed design and investigation notes in `docs/` and link them here so this remains the starting point for the project.
