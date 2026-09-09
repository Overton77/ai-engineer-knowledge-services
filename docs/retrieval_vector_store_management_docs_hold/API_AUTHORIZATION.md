# API authorization

The API uses local static identities from `KNOWLEDGE_API_IDENTITIES`. Each
bearer token resolves to one contract `Actor` and one or more explicit tenant
grants. Request headers cannot supply actor, role, or scope claims. Missing
configuration, unknown tokens, unknown tenants, empty grants, and unknown
actions all deny by default.

Tenant grants may name roles and/or individual action scopes. The admitted
roles are:

- `knowledge_reader`: system and knowledge reads plus retrieval-plan validation
- `knowledge_operator`: reader actions plus operation submission and control
- `knowledge_evaluator`: reader actions plus the bounded demo evaluation
- `knowledge_admin`: every currently admitted API action

Mutation envelopes must assert the same actor identity bound to the bearer
token. Tenant and correlation headers must also match the envelope context.
The local JSON shape is documented in `.env.example`; tokens belong only in
local or deployment secret configuration and must not be committed.
