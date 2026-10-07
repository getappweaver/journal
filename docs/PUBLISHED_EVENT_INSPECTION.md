# Published-event inspection

Captain's Log retains the published event link for an entry. Open event opens
that link; Inspect event checks availability on the author's current write
relays using the shared AppWeaver modal.

## Commands

- `/journal inspect <id>` refreshes published-event inspection.
- `/journal inspect-publish <id> --relay <url|all>` resends the original signed
  event to a selected missing relay, or all missing write relays.

Inspection distinguishes fresh retrieval, existing relay history, and relay
hints embedded in the saved link. Hints remain visible even when they are not
part of the author's current write-relay list. Failed discovery does not hide
known relay rows.

Resending uses the original signed event. If it cannot be retrieved, the plugin
does not create a replacement event.

Core retrieval and relay behavior are described in
[Nostr event resolution](../../../docs/NOSTR_EVENT_RESOLUTION.md).
