# Xanaplan - Planning Assistant

Ask planning questions alongside Anaplan, using the current page, selections and your business definitions. Xanaplan runs as a local Chrome side-panel extension with read-only access to enabled Anaplan models.

**Version 0.9.3** · [Setup guide](docs/setup.md) · [Changelog](CHANGELOG.md) · [Apache 2.0 license](LICENSE)

## What it does

- Follows the current tab’s enabled app and published board or worksheet, or stays pinned to a page you choose.
- Greets you with starter questions based on verified page cards and selections, generated locally without another AI request.
- Answers through the OpenAI or Claude connection saved in Admin, with model sources, effective filters and basic Markdown formatting.
- Shows live activity through Understanding the ask, Finding the data, Working through it and Wrapping up. The send arrow becomes a square Stop icon while answering.
- Keeps a running answer on its original page and selections when you navigate elsewhere. The answer remains visible, with a choice of context for follow-ups.
- Saves completed conversations locally. Reopen them from History and continue on the current page or with the saved page and selections.
- Uses a compact page menu, right-aligned question bubbles and a subtle blue, lavender and cream theme drawn from the supplied logo.

## Quick start

The [setup guide](docs/setup.md) covers installation from a fresh checkout, both sign-in flows, updates and troubleshooting.

You need Google Chrome 116+, Node.js, one supported AI CLI, Anaplan access, and a built [anaplan-mcp](https://github.com/larasrinath/anaplan-mcp) checkout. The tested local combination is macOS, Node.js 24.15.0, Codex CLI 0.154.0 and Claude Code 2.1.259. Only the CLI for your chosen provider is required.

1. Clone Xanaplan and build `anaplan-mcp` in a sibling directory. Repository access is required for private checkouts.
2. Sign in using `codex login` for OpenAI or `claude auth login` for Claude.
3. In the Xanaplan directory, install development dependencies and start the helper:

   ```sh
   npm ci
   npm start
   ```

4. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select Xanaplan’s **extension** folder. Pin its toolbar icon and open the side panel.
5. Sign in to Anaplan in Chrome. In **☰ → Admin settings**, configure **AI access** and complete **Anaplan access**. Use **Add app**, choose **Tenant → App**, add business context, and select **Save & enable**.
6. Open **☰ → Assistant** beside a published Anaplan page. Confirm the detected page and selections, then ask a question.

Leave the helper terminal running. It generates the local extension pairing file and listens on `127.0.0.1:8766`. Xanaplan starts its own MCP subprocess; you do not need to run another MCP server separately.

## Using the assistant

### Choose context

The compact row below the header shows the page and its mode: **Live**, **Chosen** or **Saved**. Click it to open the page menu, refresh, select another app/page, or choose **Follow current tab**. The menu overlays the conversation and closes after a successful page choice, an outside click or Escape.

Following the tab matches its origin and app ID to exactly one enabled app. Manual app/page choices and saved contexts remain pinned until you resume following. Unmatched apps require enablement or a manual selection. None of these controls navigates Anaplan or changes its selectors.

A question uses a frozen, verified page/model/selection snapshot. Navigation changes the available context for the next question; it does not cancel a running answer or relabel its sources. Explicit Stop and closing the panel still cancel the request.

### Ask and continue

- **Enter** sends; **Alt+Enter** inserts a new line.
- Starter questions fill an editable draft. They do not submit automatically.
- Live activity reports actual provider and Anaplan operations, elapsed time and connection status. It is not a completion estimate.
- **Copy answer** copies the response. Expand sources to inspect the page, model, reads, filters and limits.
- **New chat** starts a separate conversation. **☰ → History** finds earlier chats by question, app or page.
- **Continue on this page** uses freshly verified current context; **Use saved page & selections** re-verifies the original context. Earlier answers keep their sources. Unknown saved selections remain unknown and may require clarification for numeric reads.

### Admin

**AI access** stores one provider and optional model for all enabled apps. An empty model uses the provider default. Checking an unsaved choice does not activate it; select **Save settings** to apply it. Provider errors do not trigger a fallback to another provider.

**Anaplan access** handles MCP authorization separately from Chrome’s Anaplan sign-in. **Add app** discovers connected models and verifies access before saving business context. Models are included automatically. Context can be typed or imported from UTF-8 TXT, Markdown, CSV or JSON, up to 60 KB. Removing an app disables it locally.

## Supported scope and limits

| Area | Current behavior |
| --- | --- |
| Pages | Published boards and worksheets, including worksheet main grids and insight cards. Reports and edit/draft pages are unavailable. |
| Model reads | Verified page sources and relevant formula dependencies. One verified source model per question. |
| Custom cards | Underlying module evidence is available; exact displayed totals require supported filters and sufficient data. |
| Complex selections | Advanced, scoped, multi-select, runtime pivot and some line-item contexts remain limited. Unknown selections are never guessed. |
| Changes to Anaplan | Read-only. No cell/list writes, imports, exports, process runs or model administration. |
| Deployment | Local, single-person use. Shared administration and hosted deployment are deferred. |

Anaplan app/page discovery uses internal web-service contracts observed in its public clients. These can change. Automated checks establish local behavior; live schema compatibility and answer accuracy still need validation against your Anaplan app. See [page coverage](docs/page-assistant.md) and [discovery evidence](docs/discovery-api.md).

## Updating

Wait for a running answer to finish, stop the helper with **Ctrl+C**, then run from Xanaplan:

```sh
git pull --ff-only
npm ci
npm start
```

Reload Xanaplan at `chrome://extensions` and reopen its panel. An update from an older release needs both the updated helper and extension; a stylesheet-only change needs only an extension reload. Rebuild the sibling MCP when its code or dependencies change. See [update instructions](docs/setup.md#updating-an-existing-installation).

## Data and local state

- `.local/settings.json` stores enabled apps, business context, AI choices and local pairing settings.
- `.local/conversations/` stores completed messages, source details and saved page snapshots.
- `extension/local-config.js` is generated by `npm start` and contains the local pairing token.
- Chrome keeps discovery lists in extension-local storage. A failed refresh retains the previous list and its original update date.

Local settings and pairing files are ignored by Git. Do not share them or serve the repository with a generic web server. The helper checks pairing, Host and Origin and binds only to loopback.

Questions, business context and relevant retrieved data are sent through your configured AI connection. Chrome Anaplan sign-in, MCP authorization and AI CLI sign-in are separate. Saved chats survive helper restarts; unsent drafts and interrupted answers are not persisted. See [local data and backups](docs/setup.md#local-data-and-backups).

## Development and verification

```sh
npm ci
npm test
npm run check
```

The locked test dependencies require Node.js 22.x from 22.22.2, 24.x from 24.15.0, or 26+. The helper has no package runtime dependencies of its own; it uses the built sibling MCP and its SDK.

The current suite has **153 passing tests**. Tests use synthetic Chrome, MCP and AI adapters with temporary settings. Coverage includes streamed answers, explicit cancellation, navigation during answers, automatic app matching, saved-context recovery, local save failures, read restrictions and scope/revision checks. Syntax, module links, service-worker imports, extension assets and package/manifest versions are checked separately.

`npm run test:ui` opens no browser by itself; it serves a synthetic harness at `http://127.0.0.1:8768/`. It makes no live Anaplan or AI calls. It is for development, not the extension installation path. Latest native visual review was blocked by computer-use permissions; earlier browser checks apply only to the versions recorded in the detailed docs.

## Project and documentation

| Path | Purpose |
| --- | --- |
| [extension/](extension/) | Chrome side panel, UI, discovery and page tracking. |
| [server/](server/) | Paired local API, storage, AI providers and MCP bridge. |
| [tests/](tests/) | Automated tests and the synthetic UI harness. |
| [scripts/](scripts/) | Syntax, module, asset and version checks. |
| [Setup guide](docs/setup.md) | Fresh installation, sign-in, daily use, updates and troubleshooting. |
| [Architecture](docs/architecture.md) | Module responsibilities and request flow. |
| [Product design](docs/product-design.md) | Implemented Assistant and Admin behavior. |
| [Saved conversations](docs/chat-history.md) | Persistence and both continuation choices. |
| [Page assistant](docs/page-assistant.md) | Page coverage, context rules and live acceptance checks. |
| [Discovery evidence](docs/discovery-api.md) | Anaplan request contracts and verification limits. |
| [Visual theme](docs/theme.md) | Shared logo palette and UI conventions. |
| [Flow review](docs/assistant-flow-review.md) | Remaining improvements and investigation notes. |
| [Future shared administration](docs/future-management.md) | Deferred multi-user and hosted requirements. |
| [Changelog](CHANGELOG.md) | Version history. |

Update the README and relevant guides with setup, UI, behavior or configuration changes. Keep versions aligned between package and manifest, record user-visible changes in the changelog, and distinguish automated, synthetic and live verification.

## License

Copyright 2026 Lara Srinath. Licensed under the [Apache License, Version 2.0](LICENSE). Redistribution must carry the attribution in [NOTICE](NOTICE); every source file repeats the license header. Dependencies retain their own licenses.
