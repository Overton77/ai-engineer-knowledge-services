# WS-08 provider response capture handoff

Unapplied implementation handoff. The new store binds response transport custody
to a live structured-extraction operation/step lease, while retaining the
historical dispatch fence from the provider ledger. It is append-only and exact
replay returns the original database capture time; binding drift fails.

Migration `20260906031400_verification_provider_response_capture.sql` adds the
capture table, transport artifact taxonomy, and a transaction-local claim guard.
It does not alter operation terminal rules or the provider ledger. No migration
or provider call was performed.


Coordinator superseding review:06031400 was corrected and applied locally; DBcontract0.2.17 and EV-078 are accepted for the named bounded evidence. See WS-08-PROVIDER-RESPONSE-CAPTURE-REVIEW.md for actual SQL metadata binding, lock order, null-response semantics, RLS, proof, audit and remaining limitations. The initial unapplied handoff above is historical.
