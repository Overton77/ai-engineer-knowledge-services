<!-- BEGIN GENERATED: semantic-map -->
## Code navigation: packages/verification/src

Internal verification algorithm seams.

Full interfaces, dependencies, tests, and architecture: [semantic map](../../../docs/agents/CODE-MAP.md). Paths in the rows below are repository-relative.

| Module | Responsibility | Enter |
|---|---|---|
| [verification-deterministic](../../../docs/agents/CODE-MAP.md#verification-deterministic) | Canonical JSON, exact decimal replay, and the mechanical bundle verification engine. | packages/verification/src/deterministic/index.ts |
| [verification-evidence-selection](../../../docs/agents/CODE-MAP.md#verification-evidence-selection) | Locates the evidence a VerificationSelector points at inside captured bytes: core text/JSON locators, projection-backed locators, and verification of resolver claims. | packages/verification/src/evidence-selection/index.ts |
| [verification-extraction](../../../docs/agents/CODE-MAP.md#verification-extraction) | Schema-bound extraction field verification and evidence comparisons. | packages/verification/src/extraction/index.ts |
| [verification-provenance](../../../docs/agents/CODE-MAP.md#verification-provenance) | Verification seals, replay, policy inputs, attestations, and publication bindings. | packages/verification/src/provenance/index.ts |
| [verification-claims](../../../docs/agents/CODE-MAP.md#verification-claims) | Claim decomposition and report-level evidence structure. | packages/verification/src/claims/index.ts |
| [verification-authority](../../../docs/agents/CODE-MAP.md#verification-authority) | Source authority and corroboration assessments. | packages/verification/src/authority/index.ts |
| [verification-semantic](../../../docs/agents/CODE-MAP.md#verification-semantic) | Evidence-closed semantic verification, rescue, and attribution checks. | packages/verification/src/semantic/index.ts |
| [verification-providers](../../../docs/agents/CODE-MAP.md#verification-providers) | Bounded semantic-provider adapters, gateway routes, and provider registry. | packages/verification/src/providers/index.ts |

Descriptions are maintained in `.agent-docs/modules.json` at the repository root. Do not edit this generated block.
<!-- END GENERATED: semantic-map -->
