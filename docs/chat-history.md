# Saved conversations

Version 0.8.0 saves completed question-and-answer turns in the local helper. **History** opens a searchable list with the first question as its title, app/page labels and the last update time. **New chat** starts a separate conversation without removing previous ones. Delete removes only the chosen saved conversation after confirmation.

The Assistant header uses two compact App/Page dropdowns. Following the tab displays the detected page name directly. Version 0.8.1 removes the technical Context details section entirely. A muted line shows confirmed page selection values, or explicitly labels values inherited from the current tab for a manually chosen page. Independent card selections, unknown values, module mappings and diagnostic warnings are not presented as a business summary. Loading or sign-in errors remain visible when action is needed. Full context metadata remains available to the assistant when answering.

Local validation for 0.8.1: all 114 tests and the extension checks pass. Headless Chrome confirms the simplified start page fits at 320 px and 390 px, with unknown selections hidden and no runtime errors. Reload the unpacked extension to apply this display update; no helper restart is needed when 0.8.0 is already running.

## Reopening and continuing

- Reopening the panel restores the most recently updated conversation matching the current app revision, AI-settings revision and verified page/model/filter fingerprint.
- Selecting a matching conversation from History resumes it. Subsequent questions use its saved messages, with fresh MCP reads required for numeric claims.
- A conversation from another context opens for review with its original messages, sources and page context. The composer is hidden and **Back to current chat** returns to the active context. No browser navigation, app switching or filter changes are performed by History.
- Archives remain readable if an app is subsequently disabled. Reading saved history makes no AI or Anaplan calls and does not grant access to that app's models.
- Questions stopped or failed before an answer is completed, and unsent drafts, are not saved. Chats lost before this update cannot be reconstructed from the former in-memory store.

## Persistence and API

`server/conversations.mjs` writes one versioned JSON file per conversation in `.local/conversations/`, using an owner-only directory, owner-only files and atomic replacement. The directory is covered by `.gitignore`. Settings and the pairing token remain in `.local/settings.json`; saved chat files contain displayed messages, citations and page snapshots, not raw tool evidence or credentials.

`GET /conversations` lists summaries, `GET /conversations/{uuid}` retrieves a conversation, and `DELETE /conversations/{uuid}` requires its current revision. All routes use the helper's normal loopback, Host/Origin and pairing-token checks. `/chat` accepts `conversationId` and `conversationRevision`, verifies the saved scope, loads authoritative history and saves the successful turn before replying. Client-supplied history cannot overwrite saved history or move it into another context.

Each conversation supports up to 200 messages and an 8 MB file. Reaching a limit asks for a new chat; existing records are not evicted. Damaged records are reported and preserved. A write failure returns the answer with an explicit unsaved warning so it remains visible in the open panel. Stale revisions cannot overwrite another panel's saved turns.

## Validation

The automated tests cover persistence across helper restart, private file permissions, original sources/context, authoritative history, app/page/filter/provider isolation, stale revisions, read access after app removal, deletion, damaged files and visible save failure. Panel tests cover History search/open, New chat, context-safe archive review, continuing matching chats, and cancellation races.

A headless Chrome check used isolated synthetic data to create two conversations, view History at 390 px and 320 px without horizontal overflow, and reload the panel to restore the latest matching chat. The compact default header and History view were inspected visually. No live Anaplan or provider calls were made for this feature's tests.
