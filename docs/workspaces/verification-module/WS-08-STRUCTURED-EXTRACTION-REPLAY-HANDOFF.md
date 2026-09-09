# WS-08 structured extraction replay handoff

Unapplied application handoff. Replay uses a fresh trusted-artifact resolver per
call, validates the branded preparation before reading custody, and uses a
one-shot in-memory `fetch` over retained raw bytes. It has no credentials,
network transport, or persistence port. Replay reports zero external requests.
