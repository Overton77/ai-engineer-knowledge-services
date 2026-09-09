# SW-02 custody implementation review

## Conclusion

The source integration is coherent at the tested boundary. Claims and reports hydrate exact registered inputs, derive identity from trusted runtime principals, admit canonical projections through tenant-scoped grants, retain complete source handles, and seal through the native audit-bundle and verification-run recorder. Mechanical report-wide failures are monotonic and replay through the exact recorded policy inputs; no application-level pseudo-policy outcome remains.

The report result is split deliberately. The native deterministic result artifact contains exactly the canonical deterministic result required by generic recovery. A separate `verification_report_result` artifact contains the producer-declared coverage scope and report-wide mechanics; its artifact digest is the signed manifest `gateDigest`. Recovery checks the incoming deterministic result, signed gate digest, exact signed gate artifact handle, policy binding, and complete required provenance. The generic recovery loader validates the stored deterministic result and signed audit artifact against the native run row before returning the exact manifest handle.

The terminal operation result carries strict claim/report schemas, names the full manifest handle, and makes that manifest a direct parent. Its content-addressed registration is lease fenced. The registry transaction checks the live operation attempt and step lease before metadata creation, and checks again before changing object state to available. The focused stale-lease test proves that a rejected lease reaches neither registry insertion nor object storage.

HTTP admission now requires both a configured callback and an exact tenant-scoped projection grant before enqueue. API startup only installs that callback when ownership, projection, seal, parser, and runtime identity configuration are complete. This closes the R2 condition where an API flag could create permanently unhandled claims/report operations.

## Limits

The local Docker/database control path remained unreachable. The drafted artifact-type migration is unapplied, so database FK parity, transaction interleavings, object-store behavior, and recovery against a real native row remain unproven. These are explicit native acceptance blockers rather than source defects. No whole-report recall or semantic correctness claim is made: report coverage is `producer_declared_assertions_only`, and semantic support/authority remains review or failure.

Independent R3 review passed the focused application, sealer/activity, and API admission suites. Full workspace verification is delegated to the coordinator after this stable source snapshot.
