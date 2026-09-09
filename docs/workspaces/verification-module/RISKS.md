# Risk Register

| ID | Risk | Likelihood | Impact | Mitigation | Owner | State |
| --- | --- | --- | --- | --- | --- | --- |
| R-001 | Untracked repositories allow concurrent agents to overwrite the only copy of work. | high | critical | Preservation checkpoint before swarm edits. | WS-00 | open |
| R-002 | Duplicate old/new verifier implementations drift. | high | high | Parity suite, compatibility adapter, timed deprecation. | WS-02/10 | open |
| R-003 | Valid JSON is mistaken for accurate extraction. | high | critical | Field evidence, deterministic checks, gold metrics. | WS-04/07 | open |
| R-004 | Document-level citations mask unsupported claim facets. | high | critical | Atomic claims, exact fragments, weighted completeness. | WS-05 | open |
| R-005 | LLM judges exhibit self/family, position, verbosity, and prompt bias. | high | high | Blinding, cross-family cascade, human calibration, PPI/statistics. | WS-05/07 | open |
| R-006 | Interfaze provider confidence is uncalibrated or model behavior changes during beta. | high | high | Internal calibration, frozen artifacts, frequent re-baselines, shadow mode. | WS-06/07 | open |
| R-007 | Raw Interfaze MCP results bloat context and carry prompt injection. | high | high | Persist raw artifact; return bounded compact projection. | WS-06/09 | open |
| R-008 | Mutable URLs or parser updates break replay. | high | critical | Freeze bytes, version projections/selectors, content hashes. | WS-03/04 | open |
| R-009 | Provisional DB contracts become accidental public API. | medium | high | Stabilization milestone and service read models. | WS-03/08 | open |
| R-010 | Source support is misrepresented as world truth or authority. | high | critical | Separate result dimensions and policy rules. | WS-05 | open |
| R-011 | Hostile documents attack parsers, tools, judges, or networks. | high | critical | Sandboxing, SSRF/MIME/size controls, injection isolation. | WS-09 | open |
| R-012 | Provider/harness outages are counted as model-quality failures or retried blindly. | medium | high | Typed failure taxonomy and retry policy. | WS-08/09 | open |
| R-013 | Benchmark leakage or synthetic-label errors produce misleading promotion. | medium | high | Locked/private splits, real gold data, dual annotation, license tracking. | WS-07 | open |
| R-014 | Average metrics hide catastrophic numeric/identity errors. | high | critical | Severity weighting, worst-slice and upper-CI gates. | WS-07 | open |
| R-015 | Dashboard gains direct mutation authority before orchestration is durable. | medium | high | Read-only first; authenticated APIs only. | WS-10/11 | open |
| R-016 | Sensitive evidence or secrets leak through traces/manifests/model contexts. | medium | critical | Handles, redaction, classification, least privilege, restricted telemetry. | WS-09 | open |

