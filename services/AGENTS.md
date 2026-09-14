<!-- BEGIN GENERATED: semantic-map -->
## Code navigation: services

Separately deployed conversion and native parser boundaries.

Full interfaces, dependencies, tests, and architecture: [semantic map](../docs/agents/CODE-MAP.md). Paths in the rows below are repository-relative.

| Module | Responsibility | Enter |
|---|---|---|
| [docling](../docs/agents/CODE-MAP.md#docling) | Pinned Docling Serve conversion deployment boundary. | services/docling/compose.yaml |
| [verification-parser](../docs/agents/CODE-MAP.md#verification-parser) | Isolated native PDF geometry and HTML DOM parser; separate from Docling and OCR. | services/verification-parser/parser.py |

Descriptions are maintained in `.agent-docs/modules.json` at the repository root. Do not edit this generated block.
<!-- END GENERATED: semantic-map -->
