# WS-08 benchmark comparison lifecycle review

Updated 2026-09-06 UTC. Read-only review findings for the durable comparison store,
migrations `20260906030400` through `20260906030600`, and the comparison
publication contract and signing path. No acceptance claim.

## Resolution evidence

The four findings below are closed in the reviewed local chain: dedicated
publication type and terminal type enforcement are in migrations `30700` and
`31200`; ordered custody is in `30800`; terminal receipt, step and operation
success binding is in `30900`; transaction-local live lease/fencing authority
is in `31000`; and semantic artifact transformations are in `31100`.

The actual lifecycle proof completed 23 checks through a live lease and
canonical `completeStep`, producing exactly one succeeded receipt and operation:
`internal/verification-benchmark-comparison-lifecycle-33008353-22e0-4790-88f9-5e80f2e9cbb0.json`
(SHA-256 `e893390773e0e61f3b89d62967cd968abe16754fdad52bb348acd06cefcd850a`).
The independent native audit verified six stored artifacts and 14 scoped source
files:
`internal/verification-benchmark-comparison-audit-20260906.json`
(SHA-256 `04387b2f962d47e51b79ef83cccf45dafd95e3e9070d9f202ef8962743466e45`).
The coordinator owns EV and workspace acceptance decisions.

## Findings

### P1 — A comparison can be sealed with an unrelated benchmark-run publication

`RegisteredBenchmarkComparisonPublicationBuilder.publish` registers the signed
comparison manifest as `verification_run_manifest`
(`packages/application/src/verification-benchmark-comparison-publication.ts:30`),
and the lifecycle trigger admits that same type
(`20260906030500_verification_benchmark_comparison_lifecycle.sql:100`). Migration
`20260906030400` defines profile and result types but no comparison-publication
type. Consequently, `seal` can attach any same-tenant admitted benchmark-run
publication artifact; neither the store nor SQL distinguishes the new signed
comparison schema.

Add `verification_benchmark_comparison_publication`, register the builder output
under that type, and require that exact type in the lifecycle trigger. Add a
negative SQL/store test that attempts to seal with one of the input run
publication artifacts.

### P1 — Durable custody does not require the artifact parent chain used by the builder

The builder requires the result parents to be the profile, baseline publication
and candidate publication, and constructs the publication parents from those
three, the result, and optional dirty source state. The SQL trigger checks only
artifact admission by ID, type and digest (`20260906030500...sql:92-101`). It
does not inspect `verification_artifact_metadata.parent_artifact_ids`, their
order, lineage rows, or the canonical transformation signature. A caller can
complete with an unrelated admitted comparison-result artifact and an arbitrary
`result_digest_sha256`; after the artifact-type issue above, the same gap permits
an unrelated signed comparison publication and arbitrary payload digest.

At each transition, require the exact ordered parents and canonical
transformation binding already enforced by the builder. For the publication,
also bind its parents to the retained result and the dirty-state artifact named
by `runtime` when present. Add negatives for a valid same-type artifact with a
wrong profile parent, reversed publication parents, and a result digest that
does not match the retained result payload.

### P1 — Canonical operation success is not conditioned on a sealed comparison

The comparison trigger requires the operation to be running while the row is
inserted or transitioned, but no reviewed migration prevents
`compare_registered_and_publish` from succeeding when the comparison row is
absent, `running`, or merely `completed`. Migration `20260906030600` closes the
completed-time NULL check only. Generic `completeStep` accepts caller-supplied
output and reconciles the operation without checking this domain row. This can
produce a canonical succeeded operation/receipt without the signed durable
publication that the step name promises.

Guard the comparison success receipt or step transition in SQL: require the
unique row for the operation to be `sealed`, and require receipt output fields
to equal its comparison ID, input run IDs, publication artifact/digest,
publication payload digest, result digest and gate outcome. Test absent,
running, completed, and output-drift cases.

### P2 — SQL transition authority is not fenced by the operation lease

The table grants `INSERT` and `UPDATE` directly to `control_plane`
(`20260906030500...sql:123`). Its validation trigger checks the operation and
artifact state but has no lease token, fencing token, holder, step ID or expiry
condition. The TypeScript store checks these in `live`, but an accidental or
compromised control-plane SQL caller can initialize, complete, or seal while a
different worker owns the lease. The lifecycle trigger will accept it as long
as the operation remains running.

Expose transitions through a database function that validates and locks the
exact live lease/fencing tuple, and revoke direct mutation, or add an equivalent
database-enforced lease binding. Use the canonical lease lock order to avoid a
step/operation deadlock. Add direct-SQL negatives for wrong fence, released
lease, expired lease and another holder.
