# Xanaplan visual theme

The extension uses the user's supplied Xanaplan logo as its color reference, with a restrained palette shared by Assistant, History and Admin. The layout originated in the supplied **Kimi Chrome Extension HTML Design**.

Use the shared tokens in `extension/panel.css` when adding controls:

- Nearly white cool backgrounds (`--paper`), white cards (`--surface`), and dark slate text (`--ink`).
- Muted blue primary actions (`--accent`) with pale lavender chat bubbles and selection highlights (`--accent-soft`, `--accent-tint`). Use deeper blue for hovered actions, lavender for small activity accents, and soft cream for notices and the finishing glyph. Keep saturated color concentrated in small controls and the original logo.
- Shared border, shadow, hover, disabled, scrollbar and focus tokens. Semantic status dots remain green for connected, amber for attention and gray for unknown; warnings retain warm tones and readable text.
- A compact header with hamburger navigation for Assistant, History and Admin, a small brand mark and a New chat icon. Keep local/save status in the menu and app/page controls in the current-page row’s popover.
- System fonts for controls and body text, with the serif welcome heading from the reference.
- Theme colors for pending, saved, and error states. Supporting text is slightly darker than the reference for legibility.
- Layouts must fit narrow Chrome side panels. Respect reduced-motion preferences.
- Keep user message bubbles right-aligned; render answers on the left with a small Xanaplan mark, generous line spacing, safe Markdown and a Copy answer action. Long tables scroll horizontally within the answer. The conversation scrolls independently while the composer stays at the bottom.
- Show a live activity card below the pending question: actual operation, elapsed time and expandable timestamps. Stop lives in the composer action button. When the user changes pages while answering, show the original page name on the activity card. Heartbeats report helper connectivity, never fabricated reasoning or completion percentages.
- Both access cards use the shared `access-card`, `access-connection`, `connection-action` and `access-actions` styles. Keep their heading typography, account rows and right-aligned connection buttons identical; on very narrow panels both buttons stack at full width.
- Use short status text. Show sign-in instructions only when signed out and helper recovery only when unavailable. Keep OAuth fields inside **Connection settings**, and avoid repeating information already conveyed by a label, placeholder or status.
- App setup uses the same type scale and button styling. Use one Refresh action in the setup card header, place search inside the App dropdown, and use one Import file action beside Business context. The dropdown follows the same input border, lavender highlight and rounded corners; it can open upward when space below is limited. Saved-app search sits above the enabled cards. Show progress and errors inline, including original cache dates when a refresh fails.

The reference is a visual baseline. Keep the working controls and live state: a single Anaplan connection flow, saved OAuth feedback, admin-controlled OpenAI / Claude settings, model context editing, and read-only business conversations. Preview sample answers and models are not production data. The extension continues to open its side panel from the toolbar.

Answer activity has four phases with pulsing dots, orbiting rings, moving bars and finishing sparkles. A compact stage row identifies the active phase; elapsed time, live operation text, expandable activity and Stop remain available. Phases follow actual events and can revisit data collection. Never advance the phase just because time elapsed. Respect reduced-motion preferences.

The header, assistant avatars and Chrome extension icons use the supplied transparent logo in `extension/assets/xanaplan-logo.png`. Display it with its original proportions on the neutral surface.

Show one compact row with the current page name and Live, Chosen or Saved mode. Clicking it opens an anchored popover for following the tab, refreshing, or choosing app/page/model. The popover overlays content without pushing the chat down; close it after a successful page choice, an outside click or Escape. Omit a generic “App & page” heading. Errors remain inline without forcing the menu open. Following the tab matches its uniquely enabled app; manual and saved choices stay pinned.

An empty chat greets the user according to local time. Starter questions use verified card or module names and confirmed selections, with comparisons only for related cards. Clear old suggestions when context is invalidated. Keep suggestions stable during unrelated status updates, and fill an editable draft when selected. Generation uses existing metadata locally and makes no AI or Anaplan requests.

The composer asks “What would you like to understand?” and shows its keyboard shortcuts: Enter sends, Alt+Enter inserts a newline. Its single circular action button shows a send arrow when idle and a square Stop icon while answering, with matching accessible labels and tooltips. Leave page guidance with the page controls. Actionable chat errors sit outside the composer, and an IME confirmation must not send a message.
