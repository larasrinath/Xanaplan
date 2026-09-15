# Saved conversations

Completed question-and-answer turns are saved by the local helper. **☰ → History** opens a searchable list with the first question as its title, app/page labels and the last update time. **New chat** in the header starts a separate conversation without removing previous ones. Deletion requires confirmation and removes only the chosen saved conversation.

The current page appears in a compact row with an on-demand menu. A muted line shows confirmed shared selections, with inherited tab values labeled explicitly. Full source and context metadata stays attached to answers. See the [setup guide](setup.md) for installation, updates and local backups.

## Reopening and continuing

If either Chrome’s Anaplan session or MCP model authorization needs sign-in, History and saved messages remain readable. Follow-up controls stay disabled until fresh page verification is available. The recovery card identifies Browser session and Model access separately, with the relevant sign-in action and Check connection. It preserves unsent drafts and removes stale continuation notices. Either sign-in failure during saved-page restoration invalidates expired page access instead of restoring the old ticket. Model authorization links and codes are never stored with conversations. Recovery never resends a failed question automatically.

- Changing pages or selections during an answer leaves its original conversation and verified snapshot in place. Activity identifies the original page when it differs from the current page. The finished answer stays visible and offers the same current-page and saved-context choices below. A local save failure still leaves the answer available to copy, with continuation disabled until a new chat is started.
- Reopening the panel restores the most recently updated conversation matching the current app revision, AI-settings revision and verified page/model/filter fingerprint.
- Selecting a matching conversation from History resumes it. Subsequent questions use its saved messages, with fresh MCP reads required for numeric claims.
- A conversation from another context opens for review with its original messages, sources and page context. **Continue on this page** verifies the current page and enables follow-up questions within that context. **Use saved page & selections** reads the saved page again and verifies the stored model, cards and known filter IDs before switching the Assistant’s context. Changed definitions or unavailable saved members produce a recovery message while the current page remains usable. Saved unknown selections remain unknown: the conversation can reopen, and reads needing those selectors require clarification. The saved mode stays pinned across browser navigation. Neither choice navigates Anaplan or changes its selectors or Admin AI settings.
- Either choice continues the same saved conversation. A context-change marker appears before the next successful turn; previous answers retain their original sources. Earlier values are conversational background, never fresh evidence. **Back to current chat** returns without continuing.
- Archives remain readable if an app is subsequently disabled. Reading saved history makes no AI or Anaplan calls and does not grant access to that app's models.
- Questions stopped or failed before an answer is completed, and unsent drafts, are not saved. Chats lost before this update cannot be reconstructed from the former in-memory store.

## Persistence and API

`server/conversations.mjs` writes one versioned JSON file per conversation in `.local/conversations/`, using an owner-only directory, owner-only files and atomic replacement. The directory is covered by `.gitignore`. Settings and the pairing token remain in `.local/settings.json`; saved chat files contain displayed messages, citations and page snapshots, not raw tool evidence or credentials.

`GET /conversations` lists summaries, `GET /conversations/{uuid}` retrieves a conversation, and `DELETE /conversations/{uuid}` requires its current revision. All routes use the helper's normal loopback, Host/Origin and pairing-token checks. `/chat` accepts `conversationId` and `conversationRevision`, verifies the saved scope, loads authoritative history and saves the successful turn before replying. Moving to the current verified context additionally requires `continueInCurrentContext: true`. The server supplies the historical-context warning and context-change marker; client-supplied messages cannot overwrite saved history. A stopped or failed continuation leaves the saved record unchanged.

Each conversation supports up to 200 messages and an 8 MB file. Reaching a limit asks for a new chat; existing records are not evicted. Damaged records are reported and preserved. A write failure returns the answer with an explicit unsaved warning so it remains visible in the open panel. Stale revisions cannot overwrite another panel's saved turns.

Saved restoration sends `savedConversationId` and `savedConversationRevision` to `/page-context`. The helper loads the latest saved assistant context itself, pins its model, checks it against the fresh definition and resolves the saved per-card filter IDs. Browser-supplied saved snapshots cannot override it. Ticket renewals retain the saved selections and use the conversation’s updated revision after each successful turn.

## Validation

Version 0.9.5 passes all **161 automated tests**, including browser sign-in loss during continuation, model expiry during a read, saved-chat browsing while signed out and independent connection recovery without losing drafts. The tests cover persistence across helper restart, private file permissions, original sources/context, authoritative history, app/page/filter/provider isolation, stale revisions, read access after app removal, deletion, damaged files and visible save failure. Panel tests also cover both continuation choices, failed restoration, unknown saved selections, browser/app/page navigation during a running answer, explicit Stop and preservation of an unsaved answer after navigation.

Historical browser checks for earlier versions used isolated synthetic data to create two conversations, view History at 390 px and 320 px without horizontal overflow, and reload the panel to restore the latest matching chat. The compact default header and History view were inspected visually. No live Anaplan or provider calls were made for this feature's tests.

Native visual review remains blocked by computer-use permissions. Current automated DOM tests verify behavior, not pixel layout or live Anaplan accuracy.
