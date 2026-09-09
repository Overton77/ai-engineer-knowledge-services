# SW-08 IPv4-mapped IPv6 policy review

Reviewed 2026-09-06; source and focused unit tests only. No network request, database, or provider call was made.

## Reviewed snapshot

| File | SHA-256 |
| --- | --- |
| `packages/acquisition/src/http.ts` | `48508DE9DDD1E8AED14641B71D37D19E00F199982D1B5351FE9DE6151BDF4C04` |
| `packages/acquisition/src/mapped-address.test.ts` | `A2DC57C2EFD4BCA259E4B01A8D6207F19C44159F755EC0DDC57022647534A06C` |

## Result

No new source bypass or regression was found. `http.ts` has one IPv4 special-use range list and derives its IPv4-mapped IPv6 counterpart as `::ffff:<network>/<96 + prefix>`. The same `isForbiddenAddress` decision is applied when DNS results are admitted and again when a pinned socket option is built.

The test covers all 15 forbidden representative addresses in dotted IPv4, dotted mapped IPv6, and hexadecimal mapped IPv6 spelling, at both the DNS admission and pinned-socket boundary. It also preserves positive cases for globally routable IPv4, mapped IPv4, and native IPv6. The multicast/reserved `224.0.0.0/3` entry includes the reviewed `240.0.0.0/4` address family.

## Verification

| Command | Exit | Result |
| --- | ---: | --- |
| `corepack pnpm --filter @aiengineer/knowledge-acquisition exec vitest run src/mapped-address.test.ts` | 0 | 16 passed. |

The coordinator's broader acquisition test/typecheck report was 36 tests and typecheck passing; this review independently ran the targeted new file.

