# Decision worker production composition — 2026-09-08

The worker now registers `verification_adjudication_decision` only when `VERIFICATION_ADJUDICATION_DECISIONS_ENABLED=1`. The switch fails closed for all other values. Optional `VERIFICATION_ADJUDICATION_SYNTHETIC_REVIEWER_GRANTS_JSON` is parsed as a bounded strict tenant/actor/role allowlist and is rejected unless the switch is enabled; an omitted allowlist defaults to no synthetic reviewer authority.

Decision preparation continues to resolve human authority only through the canonical, unexpired reviewer-grant table. The production subject reader follows the signed packet read composition used by the API: registered artifact resolver, existing adjudication projection grants, audit grants, trusted public keys, and immutable packet replay. This worker-internal read has no public ownership authorizer because it is reached only from the canonical decision preparation path; it makes no provider call and never creates human provenance.

Focused configuration tests passed with one Vitest worker (4 tests), and the worker TypeScript check passed. Receipt: `internal/verification-decision-worker-composition-20260908.json`.

Remaining: deployment must opt in with the decision switch and a complete existing adjudication trust configuration. This change did not alter any environment, database, migration, live runtime, or external provider.
