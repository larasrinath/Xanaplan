# Xanaplan · Business Assistant

A local Chrome extension for business questions alongside Anaplan. One person switches between **Assistant** and **Admin**, enables apps, and maintains business context across their connected models. Anaplan access is read-only.

This README is a living document: update it alongside changes to setup, behavior, configuration, and verification. It describes the current implementation; proposed work lives in the linked design documents.

## Current status

- **Version:** 0.6.6, recorded in [package.json](package.json) and the [extension manifest](extension/manifest.json).
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
7. Switch to **Assistant**, select the enabled app, and ask a business question.

Anaplan webpage sign-in and MCP authorization are separate. The helper detects the public Anaplan OAuth client ID from `ANAPLAN_CLIENT_ID` or the Anaplan section of your local Codex MCP configuration. Otherwise, enter it in **Admin → Anaplan access → Connection settings**. AI sign-in is separate too; the extension never asks you to paste a subscription token.

If the MCP checkout is elsewhere, set `XANAPLAN_MCP_DIR` to its absolute path before `npm start`. Build it using `npm install` and `npm run build` in that checkout if needed. `XANAPLAN_CLAUDE_COMMAND` and `XANAPLAN_CODEX_COMMAND` can point to your installed CLIs. No cloud deployment is needed.

## Included

- Tenant, app and connected-model discovery through background GET requests, with an inline loading spinner and MCP access verification. No discovery pages or frames are created.
- Local enabled-app list, context editing, revision checks, and removal from the assistant.
- Optional UTF-8 TXT, Markdown, CSV or JSON context import, up to 60 KB. Binary model backups, PDF and Word files are not yet supported.
- Admin-managed OpenAI or Claude settings, with saved provider/model enforcement and no automatic fallback.
- Business Q&A through the saved AI connection and 16 selected MCP read tools. Sources show reads, filters, times and row limits.
- Server-enforced read-only access and enabled-app model scope. No exports, imports, process runs, cell writes or list changes.
- Separate in-memory conversations by app/context and AI-settings revision; Stop cancels inference. Old-provider history is not automatically sent to a new provider.

This version does not infer UX-card filters or follow tab changes automatically. Select the app and specify the period/scenario/entity where relevant. It discovers model structure without requiring individual page or module setup.

App discovery uses the data services called by Anaplan's own web clients. A single GET loads accessible tenants; the selected tenant's apps are then requested directly. Choosing a tenant does not change Anaplan's active tenant or open a page. Workspaces are resolved automatically from connected models; there is no workspace setup step or workspace filter.

The adapter uses internal web-service contracts observed in Anaplan's public client bundles, not a documented public Apps API. It may need updating if those contracts change. Chrome attaches session cookies; Xanaplan does not extract them. Incomplete lists, ambiguous workspace names and inaccessible models block enablement. See [request evidence and verification limits](docs/discovery-api.md).

## Recent changes

Version 0.6.0 replaces the failing offscreen tenant-menu reader with background GET requests for tenants, apps and connected models. The manifest no longer enables offscreen documents or content scripts. App ownership is checked before and after reading model associations, and the helper still verifies model access through MCP. Single-tenant accounts and empty catalogs are supported without UI scraping.

Version 0.6.1 starts both access cards collapsed and adds **Search apps** above the app dropdown. Search filters loaded names immediately, with a match count and Clear control. It keeps the current app selection and context while you search, and resets when you choose another tenant.

Version 0.6.3 gives both access cards matching headings, account rows, status dots and **Check connection** buttons. Setup guidance appears only when needed, and OAuth configuration is under **Connection settings**. AI changes show **Discard changes** and enable **Save settings**; unchanged settings keep Save disabled.

Version 0.6.4 applies the same cleanup to **Enable an app**: Refresh actions beside their fields, search grouped with App, a compact **Import file** control and shorter context guidance. Normal cache timestamps move into Refresh tooltips; loading, errors and failed-refresh warnings remain inline. Cache lifetime and access checks are unchanged.

Version 0.6.5 moves **Search apps** inside the App dropdown. Open the field to search and choose with the mouse or arrow keys and Enter; Escape closes it without changing the selection. A separate **Search enabled apps** field filters saved cards by app or tenant name. Both searches run locally and preserve context drafts.

Version 0.6.6 replaces the separate refresh controls with one **Refresh** in the app setup header. It refreshes tenants, the selected tenant's apps, and any selected app's connected models. Existing selections and draft context are retained when the selections remain available. When editing an enabled app, it refreshes that app's connected models.

## Data and local state

Tenant/app lists stay saved locally with no time expiry or automatic eviction. Refresh does not enumerate other tenants' app catalogs. A failed refresh keeps the previous list and displays its original update date. Explicit connection changes and authentication resets still clear account-related lists; connected models and access verification remain live. Reload the unpacked extension in the development Chrome profile and reopen the side panel; this frontend update does not require restarting an already-running helper. Earlier app contexts and dropdown caches remain locally available. Live credentialed requests and business-answer accuracy still need verification in the installed Chrome profile.

Settings and context live in `.local/`. Generated `extension/local-config.js` contains a local pairing token. Both are ignored by Git; do not share them or serve the project folder with a generic web server. The helper serves APIs only on 127.0.0.1 and checks pairing, Host and Origin.

AI processing is remote: questions, context and relevant Anaplan results go through the AI connection saved by Admin. Assistant displays the active provider/model and has no provider picker. This remains one person wearing two hats; separate user accounts and organization roles are deferred. Xanaplan does not save chats after the panel closes; app context is saved locally.

## Project layout

| Path | Purpose |
| --- | --- |
| [extension/](extension/) | Chrome extension, side-panel UI, and Anaplan discovery. |
| [server/](server/) | Local API helper, app/context storage, AI providers, and MCP access. |
| [tests/](tests/) | Automated tests and the synthetic UI harness. |
| [scripts/](scripts/) | JavaScript syntax and extension entry-point checks. |
| [demo/](demo/) | Demo page and fixtures. |
| [docs/](docs/) | Product design, discovery evidence, theme, and future plans. |

## Verification

```sh
npm test
npm run check
```

`npm run test:ui` runs an explicitly synthetic UI harness. It never connects to Anaplan or an AI provider and is not the extension install path.

Tests cover app persistence, multi-model source routing, verified discovery tickets, stale revisions, and discovery cancellation, plus the read-only gate, cross-model rejection, persistence/revisions, pairing/origin checks, authorization link validation, sources, truncation and cancellation. A real MCP handshake and synthetic requests through local OpenAI and Claude subscription connections were verified. Additional tests cover provider/model enforcement, stale AI settings, connection-test isolation and cancellation. Browser checks covered setup, saving/editing context, revision changes, duplicate app selection, questions, answers and sources with synthetic data. Live answer accuracy still requires Anaplan sign-in, installation in Chrome, and testing your selected app.

The earlier column-resize code remains as historical code but is no longer loaded by the manifest. Shared administration and hosting are deferred. See [the current design](docs/product-design.md) and [future shared administration](docs/future-management.md).

## Documentation

- [Current product design](docs/product-design.md): Assistant and Admin flows, architecture, and practical bounds.
- [Discovery API evidence](docs/discovery-api.md): request contracts, access checks, and verification limits.
- [Visual theme](docs/theme.md): interface styling guidance.
- [Future shared administration](docs/future-management.md): proposed requirements and open decisions for a later hosted version.

## Keeping this document current

Update this README in the same commit as any change that affects installation, UI flows, supported behavior, configuration, or data handling. Keep the version above aligned with the package and extension manifest when releasing, and add a concise entry under Recent changes for user-visible updates.

Keep implemented features, known limitations, and future plans distinct. When reporting verification, say whether it used automated tests, synthetic fixtures, or a live signed-in Anaplan account; do not treat one as evidence for another. Put detailed design and investigation notes in `docs/` and link them here so this remains the starting point for the project.
