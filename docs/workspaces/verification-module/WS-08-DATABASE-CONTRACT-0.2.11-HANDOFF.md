# WS-08 Database Contract 0.2.11 Handoff

`@aiengineer/database-contract` is packaged as version `0.2.11` and Knowledge
Services pins the immutable local archive at
`packages/persistence/vendor/aiengineer-database-contract-0.2.11.tgz`.

Archive SHA-256:
`e52be8cbdc57fbf98a7df31ab689983e901c3f6be26ade3c69ca8d9e4f6b370c`.
The installed persistence dependency reports version `0.2.11`; the lockfile
resolves only its local vendor tarball with integrity
`sha512-h8ru2zK/sSzDLwBT8wGzLJOVC4EvHSAvxqPErhXJtwKzz+QJjSh/goc+Ee56HIZnsbG9TuiEK7mU0GrmAo0lOQ==`.

The archive contains the three canonical artifact-type migrations, each
byte-identical to the local canonical source and the installed vendor package:

- `20260906025000_verification_benchmark_experiment_artifact.sql` — SHA-256 `d4cc7a0ed9202086fb8344e12205ad4d59a4d29361053b914a9f02f23f3b4bb1`
- `20260906026000_verification_benchmark_profile_artifact.sql` — SHA-256 `6c678ba722bd8ec459de79ce9c55f90d5a895ea3cfbc37cbe20f3d6bb38c2e5b`
- `20260906027000_verification_benchmark_recorded_call_artifact.sql` — SHA-256 `b7681f24111ed4ff500bfed082f5a75169b60999b2915b7d727329205a48187e`

Validation used the existing local database only: `pnpm run types:check`
reported generated types current, and `pnpm run typecheck` passed in the
database-contract workspace. No generated-type change was required for these
artifact-type-only migrations. The package was created with installed pnpm
11.15.1. Knowledge Services updated its lockfile offline with Corepack pnpm
10.34.5 and completed its non-destructive offline install with installed pnpm
11.15.1 and `--ignore-scripts`. No reset, migration apply, remote command, or
full Knowledge Services test suite was run.
