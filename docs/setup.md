# Setup guide

Install and use **Xanaplan - Planning Assistant 0.9.3** on your own computer. The commands below use a macOS shell, matching the tested development environment.

## What you will run

| Component | Purpose |
| --- | --- |
| Xanaplan Chrome extension | Displays the assistant beside Anaplan and reads published page metadata and selected context. |
| Xanaplan local helper | Saves settings/chats and coordinates AI requests and read-only model access on `127.0.0.1:8766`. |
| Built `anaplan-mcp` checkout | Supplies Anaplan authorization and read tools. The helper starts this subprocess automatically. |
| Codex CLI or Claude Code | Uses your chosen AI account. Only one provider is required. |

Load Xanaplan itself as an unpacked Chrome extension. A separate browser-automation extension is not part of setup.

## Prerequisites

- Google Chrome 116 or later, as required by the extension manifest. Use your regular Chrome profile signed in to Anaplan.
- Git and access to the Xanaplan and `anaplan-mcp` repositories. Private repositories require an authorized GitHub account.
- Node.js and npm. The tested version is Node.js **24.15.0**. The locked development dependencies also support Node.js 22.x from 22.22.2, 24.x from 24.15.0, or 26+.
- An Anaplan account with access to the intended UX app and its connected models, plus an Anaplan OAuth client ID configured for device authorization.
- Either [Codex CLI](https://developers.openai.com/codex/cli) for OpenAI or [Claude Code](https://code.claude.com/docs/en/setup) for Claude, installed using its official instructions. These adapters were verified with Codex CLI **0.154.0** and Claude Code **2.1.259**; those are tested versions, not a guarantee that every newer version is compatible.

Check the tools in Terminal:

```sh
git --version
node --version
npm --version
```

## 1. Clone and build

For a fresh installation, place both projects beside each other:

```sh
mkdir -p ~/Projects/Github
cd ~/Projects/Github
git clone https://github.com/larasrinath/anaplan-mcp.git
git clone https://github.com/larasrinath/Xanaplan.git
```

Build the MCP:

```sh
cd ~/Projects/Github/anaplan-mcp
npm install
npm run build
```

Its `dist/index.js` and `node_modules/@modelcontextprotocol/sdk` must exist. Xanaplan uses this local build; you do not need to add it to a desktop chat application or start a separate MCP process.

Install Xanaplan’s development dependencies:

```sh
cd ~/Projects/Github/Xanaplan
npm ci
```

If you already have either checkout, use the existing folder. For a different MCP location, see [optional configuration](#optional-configuration).

## 2. Sign in to your AI provider

Run the commands for the provider you intend to select in Admin.

**OpenAI through Codex:**

```sh
codex --version
codex login
codex login status
```

**Claude through Claude Code:**

```sh
claude --version
claude auth login
claude auth status
```

Complete the CLI’s browser sign-in flow. Xanaplan uses that CLI’s authentication; it does not ask you to paste a subscription token. Your AI account’s access and usage limits still apply.

## 3. Start the local helper

From the Xanaplan directory:

```sh
npm start
```

Wait for **“Xanaplan local helper is running.”** Keep that terminal open. Startup creates `.local/` and generates `extension/local-config.js` with the local pairing settings. Stop the helper with **Ctrl+C** when you are finished.

The helper is an API service, not a website to open in a browser. The app interface is the Chrome side panel.

## 4. Load the Chrome extension

1. Open `chrome://extensions` in your Chrome profile.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select `Xanaplan/extension`, not the repository root.
5. Confirm **Xanaplan - Planning Assistant** appears with its blue/lavender logo and is enabled.
6. Open Chrome’s extensions menu, pin Xanaplan, and click its icon to open the side panel.

If it was already loaded, use the extension card’s **Reload** button. Close and reopen the side panel after reloading.

## 5. Connect AI and Anaplan

### AI access

1. Open **☰ → Admin settings → AI access**.
2. Choose **OpenAI** or **Claude**.
3. Leave **Model** empty for the provider default, or enter a model available to your account.
4. Click **Check connection**. This sends a small synthetic test request.
5. Click **Save settings** if you changed the provider or model.

Testing an unsaved choice does not activate it. The saved provider/model applies to all enabled apps; there is no automatic fallback to another provider.

### Anaplan access

Chrome’s Anaplan sign-in and the MCP’s Anaplan authorization are separate. Both need access to the app and its models. Xanaplan currently configures its MCP subprocess for OAuth device authorization only; the standalone MCP’s certificate and basic-auth options are not exposed by Xanaplan.

1. Sign in to Anaplan in the same Chrome profile.
2. Open **Admin settings → Anaplan access**.
3. If a client ID is needed, expand **Connection settings**, enter your Anaplan OAuth client ID, and click **Save settings**. No client secret is requested.
4. Click **Check connection**.
5. When an authorization link/code appears, complete the Anaplan sign-in flow, then click **Check connection** again.

A saved client ID takes priority. Otherwise, the helper uses `ANAPLAN_CLIENT_ID`, or the public `ANAPLAN_CLIENT_ID` value in the Anaplan section of `~/.codex/config.toml`. It does not import unrelated MCP configuration or credentials.

### Enable an app

1. In Admin, click **Add app**.
2. Choose the **Tenant**, then search for and select the **App**.
3. Wait for the connected models to be discovered and verified. These are read-only details; they are included automatically.
4. Add business context: purpose, definitions, units/currency, calendar, versions and assumptions. You can import UTF-8 TXT, Markdown, CSV or JSON up to 60 KB, then edit it.
5. Click **Save & enable**.

Repeat for other apps you want available. You do not need to open an app in Anaplan before enabling it.

## 6. Ask your first question

1. Open a published board or worksheet from an enabled Anaplan app.
2. Switch Xanaplan to **☰ → Assistant**.
3. Confirm the compact page row matches your tab. **Live** means it follows the tab; **Chosen** means a manual page; **Saved** means a restored chat context.
4. Try a metadata question such as “Which modules support this page?” Then ask about a known figure and compare the response and source filters with Anaplan.

The page row opens a small menu for **Follow current tab**, **Refresh**, and app/page/model selection. Following matches the tab to exactly one enabled app. Choosing another app or page pins it for chat until you resume following; it does not navigate Anaplan.

**Enter** sends and **Alt+Enter** adds a line. Suggested questions fill a draft. While answering, the send arrow becomes a square **Stop** icon and the activity card shows real operations and elapsed time.

Changing pages or selections leaves a running answer on its original verified context. After it completes on a different page, choose **Continue on this page** or **Use saved page & selections** for follow-ups. **☰ → History** offers the same choices for older chats. Explicit Stop or closing the panel cancels a running request; completed chats remain saved.

## Updating an existing installation

Wait for a running answer to finish, then stop the helper with **Ctrl+C**. Keep `.local/` to preserve your settings and completed conversations.

If the update requires a newer `anaplan-mcp`, update and rebuild it while the helper is stopped. For the sibling layout used in this guide:

```sh
cd ~/Projects/Github/anaplan-mcp
git pull --ff-only
npm install
npm run build
```

Use your actual checkout path if it differs. Rebuild whenever the MCP’s source or dependencies change; Xanaplan uses its compiled `dist/index.js`.

Update Xanaplan and restart the helper:

```sh
cd ~/Projects/Github/Xanaplan
git pull --ff-only
npm ci
npm start
```

Wait for the helper’s startup message, reload Xanaplan at `chrome://extensions`, and reopen its panel. In Admin, check **AI access** and **Anaplan access**; complete Anaplan authorization again if prompted. Return to Assistant and confirm the page row matches the intended context.

If Git reports local source changes or a non-fast-forward update in either checkout, resolve those changes before retrying. A helper/backend update requires a helper restart; extension-only changes need an extension reload.

## Optional configuration

Set these variables in the terminal that starts the helper. Saved Anaplan client settings take priority over client-ID discovery.

| Variable | Purpose |
| --- | --- |
| `XANAPLAN_MCP_DIR` | Absolute path to a built MCP checkout; defaults to `../anaplan-mcp` beside Xanaplan. |
| `XANAPLAN_CODEX_COMMAND` | Codex executable path if the helper cannot find it. |
| `XANAPLAN_CLAUDE_COMMAND` | Claude executable path if the helper cannot find it. |
| `ANAPLAN_CLIENT_ID` | Public OAuth client ID used when no client ID is saved in Admin. |

Example with a custom MCP location:

```sh
XANAPLAN_MCP_DIR="/absolute/path/to/anaplan-mcp" npm start
```

Xanaplan’s helper port is fixed at `8766`. `XANAPLAN_UI_PORT` changes only the synthetic developer harness port.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Local helper unavailable or pairing failure | Start `npm start` from the same checkout whose `extension` folder is loaded. Reload the extension after its pairing file is generated. |
| Port 8766 already in use | Another helper is running. Use its checkout, or stop it in its terminal before starting this one. |
| MCP unavailable | Build the MCP and confirm `XANAPLAN_MCP_DIR` points to the checkout containing both `dist/index.js` and its installed SDK. |
| AI provider unavailable | Confirm the selected CLI runs and is signed in. Set its executable override if needed, restart the helper, then check AI access in Admin. |
| Signed in to Anaplan, but model access fails | Complete MCP authorization as well as Chrome sign-in. Confirm the account can access every connected model. |
| Wrong app or page | In the page menu choose **Follow current tab**. Manual/saved choices stay pinned. Enable unmatched apps in Admin; ambiguous matches need a manual choice. |
| A worksheet is marked unsupported | Reload the current extension. Version 0.9.3 recognizes Anaplan’s `GRID-PAGE` worksheet catalog type. Reports and edit/draft pages remain unavailable. |
| Saved selections cannot be restored | Use **Continue on this page**, or verify access to the original page and members. Unknown saved selections are retained and may require clarification for a numeric read. |
| Answer takes a long time | Expand Activity to see the last operation and elapsed time. A connected helper does not mean the provider or Anaplan read has finished. Use the square Stop icon to cancel and retry. |
| Answer could not be saved | Copy the answer before starting a new chat. Check disk space and access to `.local/`. A failed save does not overwrite earlier saved turns. |
| New title, theme or controls are missing | Reload the extension and reopen the side panel. Restart the helper too if backend files changed. |

**“Service worker (Inactive)” is normally an idle state**, not an error. Chrome can stop an idle worker and wake it for the next extension event. The extension’s enabled toggle and its behavior are the useful checks. See [Chrome’s worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle#idle-and-shutdown).

## Local data and backups

Settings and completed conversations live in Xanaplan’s `.local/` directory. Stop the helper before making a private backup of that directory. Treat the backup as sensitive: it includes business context, saved answers, source snapshots and local pairing settings. Restore it only into a stopped checkout, start the helper to regenerate pairing configuration, and reload the extension. Separate CLI and Anaplan authorization may still be required.

`.local/` and `extension/local-config.js` are ignored by Git. Do not commit or share them. The extension uses Chrome-managed session cookies; the helper launches the MCP with the public client ID. Questions and relevant retrieved data go to the configured AI provider.

## Development checks

```sh
npm test
npm run check
npm run test:ui
```

The first two commands run automated checks. The last starts a synthetic harness at `http://127.0.0.1:8768/`; open that URL yourself for fixture-based UI testing. The harness uses temporary settings and no live Anaplan or AI requests. It is separate from the actual extension and does not install it.

For live validation, use the [page acceptance checks](page-assistant.md#live-acceptance-checklist). For internal behavior, see [architecture](architecture.md), [saved chats](chat-history.md) and [theme](theme.md). See the [Anaplan affiliation and trademark disclaimer](../README.md#disclaimer). The project is licensed under [Apache 2.0](../LICENSE).
