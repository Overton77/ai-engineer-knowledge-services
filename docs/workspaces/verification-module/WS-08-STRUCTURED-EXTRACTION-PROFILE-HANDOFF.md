# WS-08 structured extraction profile-admission handoff

Updated 2026-09-06. This handoff describes a bounded implementation only. It
does not accept a production extraction route, provider availability, billing,
or provider promotion.

## Delivered boundary

`packages/application/src/verification-structured-extraction-profile.ts`
provides `StructuredExtractionProfileAdmission`. It accepts an explicit
`{ tenantId, request, signal? }`, plus a server-owned runtime grant catalog,
a trusted artifact resolver, and `hydrateAdmittedProjection` from
`VerificationAdmissionService`.

It returns a frozen, private-WeakMap-branded preparation that future executor
code can verify with `assertPrepared`. A structurally similar object cannot
pass that check. The module intentionally has no provider SDK, secret, network,
dispatch, accounting mutation, result registration, or operation-lease port.

The producer profile is strict
`verification-structured-extraction-profile.v1`:

- tenant ID; `registered_default` profile ID; profile version;
- exact extraction-schema artifact reference;
- Gateway or Interfaze structured-text registration ID and exact configuration
  digest;
- synthetic or public external-processing classification, text modality only;
- `budgetId`, `budgetKey`, `ceilingCostMicros`, and
  `reservationCostMicros`, with a 20,000,000 microUSD hard maximum and no
  over-reservation;
- `maximumPromptBytes`, capped at 24,000 UTF-8 bytes.

The server-owned runtime grant binds a tenant/capture to exact source,
representation, transformation, extraction-schema, and producer-profile
artifacts. Caller input remains the existing strict
`ExtractStructuredDataRequestSchema`; it cannot choose provider, budget,
credentials, source bytes, transformation, or grant.

## Admission behavior

Preparation hydrates both profile artifacts through authorize-then-hydrate,
checks exact handle/digest/bytes, parses the existing
`VerificationExtractionProfileSchema`, and admits its bounded output schema
through `admitExtractionSchema`. It then asks the injected admission port to
hydrate the capture-bound projection. The profile's source, every evidence
edge, representation, and transformation must exactly match the request and
grant.

Every field-rule path must have one corresponding evidence path. Each selector
is resolved against the admitted projection with `projectionSelectorResolver`;
non-resolved, ambiguous, digest-mismatched, or unsupported selections fail
closed. The provider prompt contains only canonical schema plus selected
evidence fragments, never arbitrary projection bytes. Its serialized UTF-8
length must remain within both profile and 24,000-byte global limits; content
is never truncated.

The returned provider record retains the actual registry promotion state. A
`lab` registry value is diagnostic and does not itself grant live dispatch.

## Coordinator integration requirements

1. Coordinator exported the new module from the application package index after review.
2. Root's durable executor must accept only a branded preparation and must
   retain the profile artifact/digest in its output manifest.
3. Keep the provider ledger work separate: before any external call it must
   bind the operation/step/active lease/fence, reserve, and claim dispatch.
   A post-dispatch timeout is uncertain and cannot trigger a second dispatch.
4. Add the canonical `verification_structured_extraction` operation and its
   `extract_and_register` step before exposing an HTTP/client/CLI/MCP mutation.
5. The profile artifact type reserved by the coordinator is
   `verification_structured_extraction_profile`; this module only expects a
   registered artifact and does not register it.

## Focused verification

```
pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-structured-extraction-profile.test.ts
pnpm --filter @aiengineer/knowledge-application exec tsc --noEmit
```

Both passed: 4 focused tests and application TypeScript compilation. Tests
exercise successful synthetic selected-evidence preparation and branding,
cross-tenant/no-grant rejection, profile/provider drift, schema artifact byte
binding, and cancellation before hydration.


## Coordinator review corrections

The initial four tests were insufficient to establish their named boundaries. Root expanded the suite to17 cases and strengthened production admission: server grants and producer schema references contain full canonical handles; hydration checks tenant, size, exact metadata and actual bytes; returned preparations retain all custody handles and can be accepted only by the issuing catalog instance. A256-grant bound is enforced. Exact schema scalar leaves must match field rules and evidence. This initial producer supports fixed object schemas; arrays and open objects explicitly fail closed. Projection receipt capture and actual content bytes are rechecked before selector use. Tests now independently reach coverage, selector, prompt-bound, metadata drift and mid-hydration cancellation gates with valid fixture custody. These are controlled port tests, not live native parser or provider proofs.
