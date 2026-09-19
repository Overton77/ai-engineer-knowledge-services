# Preparation CLI reference

Two binaries share the `knowledge` name. Use the one your environment loaded.

## Executor (`apps/verification-executor`)

Prepare an existing plain text or Markdown capture (pinned deterministic convert + chunk). This does not acquire a new source and does not admit the representation.

```text
knowledge source prepare-captured <captureId> --title '<title>' --version '<version>'
```

Content-link and summary close-out stay on the executor:

```text
knowledge content plan <intent.json>
knowledge content apply <intent.json>
knowledge content receipt <receiptId>
knowledge content prepare-summary <operation.json>
```

## Platform (`apps/cli`)

```text
knowledge document convert --context '<OperationContext>' --input '<knowledge.transformation/v1>'
knowledge document compare --context '<OperationContext>' --input '<representation comparison input>'
knowledge chunk preview --context '<OperationContext>' --input '<knowledge.chunk-preview/v1>'
knowledge chunk build --context '<OperationContext>' --input '<knowledge.chunk-set/v1>'
knowledge promotion propose --context '<OperationContext>' --input '<promotion proposal input>'
knowledge promotion review --context '<OperationContext>' --input '<promotion decision input>'
knowledge promotion status --context '<OperationContext>' --input '{"operationId":"<uuid>"}'
```

`document convert` submits operation kind `transformation`. Input must name a completed capture and a `providerRoute` of admitted keys. The worker applies package policy order among those keys: text → Docling → gated Unstructured.

```json
{
  "schemaVersion": "knowledge.transformation/v1",
  "captureOperationId": "11111111-1111-4111-8111-111111111111",
  "document": {
    "documentKind": "official_docs",
    "canonicalTitle": "Durable agents",
    "versionLabel": "2026-09-16"
  },
  "profile": {
    "profileKey": "pdf",
    "version": "1.0.0",
    "mediaType": "application/pdf",
    "managedProcessingAllowed": false
  },
  "providerRoute": ["deterministic-structural-text", "docling-serve"]
}
```

`managedProcessingAllowed` must be true before Unstructured can run. A conversion routing receipt is not admission.
