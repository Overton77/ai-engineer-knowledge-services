# Benchmark comparison process-crash handoff

## Scope

This bounded proof owns actual OS-process recovery for the registered benchmark
comparison worker at two committed boundaries: after durable result completion
and after publication sealing but before the canonical terminal receipt. It uses
the configured production comparison factory, canonical registry and canonical
worker. Test interception is confined to the child proof process and occurs only
after the real store method commits.

The proof does not change production behavior, disable database guards, alter
lease timestamps, reset local services, dispatch providers, or establish a
deployment-wide recovery claim. Evidence and final validation will be recorded
here after execution.

## Result

The final local proof passed and retained
`../../../../internal/verification-benchmark-comparison-crash-834bbf84-4341-4269-8835-514effb9ba84.json`,
SHA-256
`b275445248304aaffe77d5ecdddcbe834f75557d8b69c5fc67d7600137c9ab6b`.
Both scenarios use the immutable v3 profile grants and original signed completed
benchmark publications from the accepted comparison application proof. The
comparison signing private key exists only in parent memory and child process
environment; the receipt retains its public key. External provider requests are
zero.

- After the real result-completion transaction, the parent observed comparison
  `fdf678b4-12d1-53ef-a82e-1af5e645f902` in `completed`, with its result artifact,
  result digest and DB timestamps committed and no publication or receipt. It
  killed child process ownership of operation
  `4b0c735c-3f55-4a6a-8497-c2ce337eeef5`, waited for the ordinary lease to expire,
  and started a separate replacement. The fencing token increased from 359 to
  361. The replacement retained the original start/completion times and exact
  result identity, then sealed and completed the canonical operation once.
- After the real seal transaction, the parent observed comparison
  `e21e8922-d6c2-5b4a-abce-e50c7ed5745d` in `sealed`, with no terminal receipt. It
  killed child process ownership of operation
  `bfe4eea6-910d-46fd-ab16-48d96937d227`, observed natural lease expiry, and ran a
  separate replacement. The fencing token increased from 362 to 364. The
  replacement reused the exact result, publication artifact, payload digest and
  original timestamps, then completed the canonical operation once.

For both operations the proof records the `SIGKILL` termination, one comparison
row, one successful canonical receipt, a higher replacement fence, and rejection
of completion using the dead worker claim. It hydrates the actual registered
result and recomputes its semantic digest, hydrates the publication, verifies its
Ed25519 signature and signing key, and confirms the publication's exact operation,
comparison, timing, result and zero-provider bindings. Quality claims remain
`humanGoldValidated: false`, `sourceAuthorityAssessed: false`, and
`calibrated: false`.

The receipt contains a registered scoped source snapshot over 11 proof, worker,
application, persistence and signature files. All 11 hashes matched current bytes
after the run. This is source custody for these two boundaries, not a complete
dependency graph or deployment image. Strict TypeScript validation passes with
`pnpm exec tsc -p scripts/tsconfig.verification-benchmark-comparison-crash.json --noEmit`.

Two earlier diagnostic executions, namespaces
`ec01db8a-8a68-4e30-bf7a-cceb927a6751` and
`b5ff6e42-d7bb-41f0-a25f-af0314a78e85`, completed recovery of the first scenario
but then failed proof-only assertions that compared full artifact handles with
compact durable references. They emitted no passing crash receipt. Their valid
canonical succeeded rows were preserved; no row, artifact or operation was
rewritten or deleted. The corrected proof compares canonical artifact ID and
digest fields explicitly.

This evidence is limited to the two named local committed boundaries and the
configured registered comparison runtime. It does not cover every artifact-write
window, disconnected execution, multiple hosts or deployment rollout. The inputs
remain offline-recorded replay observations, so it makes no human-gold,
source-authority, calibration, population, promotion or benchmark-quality claim.
No EV acceptance claim is made in this handoff; the coordinator owns acceptance
and the independent audit.
