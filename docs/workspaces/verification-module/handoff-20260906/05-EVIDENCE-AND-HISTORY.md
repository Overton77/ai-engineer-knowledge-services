# Evidence history, caveats and navigation

## Recent accepted review sequence

| Evidence | Review in parent workspace | What it establishes |
|---|---|---|
|EV-087|WS-08-STRUCTURED-EXTRACTION-WORKER-REVIEW.md|Configured worker producer path and retained publication recovery.|
|EV-088|WS-08-STRUCTURED-EXTRACTION-READS-REVIEW.md|Authenticated internal terminal reads.|
|EV-089|WS-08-STRUCTURED-EXTRACTION-TRANSPORTS-REVIEW.md|Public extraction transport admission/reads.|
|EV-090|WS-08-STRUCTURED-EXTRACTION-PROCESS-REVIEW.md|Actual post-publication process death/replacement.|
|EV-091|WS-08-STRUCTURED-EXTRACTION-DISPATCH-REVIEW.md|Actual dispatch/no-response uncertainty recovery.|
|EV-092|WS-08-PROVIDER-RECONCILIATION-ADMISSION-REVIEW.md|Signed evidence admission; no settlement claim.|
|EV-093|WS-08-PROVIDER-RECONCILIATION-SETTLEMENT-REVIEW.md|Atomic failed/cancelled settlement and overrun.|
|EV-094|WS-08-PROVIDER-RECONCILIATION-PUBLICATIONS-REVIEW.md|Successful operation settlement and original publication stability.|
|EV-095|WS-08-PROVIDER-RECONCILIATION-READS-REVIEW.md|Historical applied-decision reads without mutation authority.|
|EV-096|WS-08-PROVIDER-RECONCILIATION-HTTP-REVIEW.md|Actor/mission-authorized runtime HTTP/client.|
|EV-097|WS-08-PROVIDER-RECONCILIATION-TRANSPORTS-REVIEW.md|Built CLI and MCP Streamable HTTP settlement/read.|

Read the linked review file in ../ for exact artifact filenames and SHA256. snapshot.json independently hashes the latest available outputs during this handoff. The proof artifacts live under the parent repository root internal/, not KS/internal/. Some historical documents use the latter-looking relative notation; resolve carefully.

## Historical foundations and diagnostics pilot

Read FOUNDATION-REVIEW.md, PERSISTENCE-REVIEW.md, SELECTOR-REVIEW.md, PARSER-REVIEW.md, ADMISSION-REVIEW.md, SEMANTIC-POLICY-REVIEW.md, PROVIDER-REVIEW.md and WS-07-INDEPENDENT-ACCEPTANCE.md. The last documents accepted engineering pilot run feeb824c-e4d0-597f-abd7-7667fa080869:117 calls across39 cases,110 structured successes,7 HTTP200 schema failures,709 unique artifacts independently replayed. Recorded accounting was99,754 microUSD settled and1,950,000 held for unknown Interfaze billing. Do not assume later synthetic reconciliation settled that historical live pilot liability.

V2 reports were rejected for adversarial narrative contamination, failure classification and non-navigable citations. V3 normalization demonstration was rejected. V4 corrected those issues with a separately labelled synthetic normalization fixture; V5 changed safe bold formatting. Preserve those distinctions. Final V5 manifest and artifact review paths/hashes are in WS-07-INDEPENDENT-ACCEPTANCE.md. The180-candidate preparation pack reproduced against1,186 frozen fragments, but the provisional90/14/76 leakage-group split and annotations still require human review. Human gold was zero. Engineering extraction agreement is not clinical accuracy or complete research coverage.

## Other durable service histories

WS-08-METRIC-* and WS-08-RUN-SEALING-HANDOFF.md cover mechanical metric service, trusted policy/seal inputs and recording. WS-08-SEALED-REPLAY-ACTIVITY-HANDOFF.md and related replay documents cover retained deterministic replay. WS-08-BENCHMARK-* documents cover the successive input/profile/projection/executor/publication/comparison boundaries. WS-10-HTTP-RUNBOOK.md and DISPATCH/CANCELLATION/RECOVERY handoffs cover local Mission Control/Temporal work (EV-043–048). These are locators, not permission to infer every planned item is complete.

## Known operational traps

1. KS .env is remote; the safe helper injects local credentials without printing them.
2. Local-reset incident data is real; do not recreate pre-reset budgets or assume filesystem artifacts imply current native custody.
3. Exact settled cohorts cannot accept new signed decisions. Create fresh preparation for first-time settlement proofs.
4. Original publication providerCall may remain uncertain even after native accounting is settled. This is intentionally signed history, not a stale-state bug to rewrite.
5. Ordinary settlement requires response evidence. Migration329's missing-response exception is narrowly bound to the immutable reconciliation ledger, not a general bypass.
6. Admission permits use in-memory issuer branding and expiry. Do not serialize/clone/reconstruct them or reuse historical verification output for apply.
7. Source/runtime identity is intentionally strict. New code invalidates same-source parity claims for old runs; it does not license rewriting old source-custody manifests.
8. Child process proofs use Node --import tsx with a direct child script, actual SIGKILL and natural lease expiry. A CLI wrapper or injected exception may have different semantics.
9. Full artifacts can contain restricted source material, object keys and billing details. Public API results are compact; do not expose full internal manifests in browser/MCP responses.
10. Check subprocess exit status separately from a later shell command's success. Do not let a log-tail command conceal a failed build/proof.

## Scope of this documentation checkpoint

Only documentation and a documentation-generation helper were added for this user request. No new provider calls, migrations, implementation changes or completion claim are required by it. The last engineering tests are EV-097; this handoff validates its own inventory, references and hashes. Follow user's next instruction before continuing the engineering backlog.
