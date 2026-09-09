# Temporal Cloud isolated CPH setup — 2026-09-08

An authorized isolated namespace is active for the Consumer Proof Harness: `verification-cph-20260908.ih0e7` at `us-east-1.aws.api.temporal.io:7233`. It has API-key authentication, TLS, one `aws-us-east-1` replica, on-demand capacity, and one-day retention. The agreed task queue name is `verification`; Temporal does not separately provision task queues.

One POST used fixed async operation `0ef2dd14-1cb0-4b80-b8a8-dc0ee12dc929`. A local command-observation timeout occurred after the immutable intent was written; it was not retried. Read-only recovery established `STATE_FULFILLED` and `RESOURCE_STATE_ACTIVE`. A real TypeScript SDK connection and read-only visibility query succeeded with zero workflow rows. Direct namespace GET returned authorization code 7 under the control-plane key; list and SDK evidence remain retained.

Use only server-scoped `TEMPORAL_API_KEY` (or existing `TEMPORAL_CLOUD_API_KEY` alias), `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, and `TEMPORAL_TASK_QUEUE`. No secret is in this document/config. No workflow or worker has been launched.

Receipt: `C:\Users\Pinda\Proyectos\aiengineer\internal\verification-temporal-cloud-setup-0ef2dd14-1cb0-4b80-b8a8-dc0ee12dc929.json` (`sha256:39076f48473c21962b386e92c3288e0bebd1df584b3efb261dfb7cd5b2df4abb`). Nonsecret config: `C:\Users\Pinda\Proyectos\aiengineer\internal\verification-temporal-cloud-setup-0ef2dd14-1cb0-4b80-b8a8-dc0ee12dc929.config.json`.
