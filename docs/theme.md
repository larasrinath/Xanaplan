# Xanaplan visual theme

The extension follows the user's supplied **Kimi Chrome Extension HTML Design**, using `xanaplan-redesign/panel.css` as the base. The same stylesheet is used in the reference's Assistant and Admin previews.

Use the shared tokens in `extension/panel.css` when adding controls:

- Sage page background (`--paper`), white cards (`--surface`), and dark green text (`--ink`).
- Deep green primary actions (`--accent`) with pale green highlights (`--accent-soft`, `--accent-tint`).
- Segmented Assistant / Admin tabs; rounded controls and cards; subtle borders and shadows.
- System fonts for controls and body text, with the serif welcome heading from the reference.
- Theme colors for pending, saved, and error states. Supporting text is slightly darker than the reference for legibility.
- Layouts must fit narrow Chrome side panels. Respect reduced-motion preferences.
- Both access cards use the shared `access-card`, `access-connection`, `connection-action` and `access-actions` styles. Keep their heading typography, account rows and right-aligned connection buttons identical; on very narrow panels both buttons stack at full width.
- Use short status text. Show sign-in instructions only when signed out and helper recovery only when unavailable. Keep OAuth fields inside **Connection settings**, and avoid repeating information already conveyed by a label, placeholder or status.
- App setup uses the same type scale and button styling. Use one Refresh action in the setup card header, place search inside the App dropdown, and use one Import file action beside Business context. The dropdown follows the same input border, sage highlight and rounded corners; it can open upward when space below is limited. Saved-app search sits above the enabled cards. Show progress and errors inline, including original cache dates when a refresh fails.

The reference is a visual baseline. Keep the working controls and live state: a single Anaplan connection flow, saved OAuth feedback, admin-controlled OpenAI / Claude settings, model context editing, and read-only business conversations. Preview sample answers and models are not production data. The extension continues to open its side panel from the toolbar.
