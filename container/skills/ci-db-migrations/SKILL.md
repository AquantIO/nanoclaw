---
name: ci-db-migrations
description: Use when adding automatic DB migrations (alembic upgrade head) to a repo's CI, when a deploy is blocked on unapplied migrations, or when schema drift between image and DB is suspected. Reusable in-cluster-Job pattern, gated before gitops-update.
---

# CI DB migrations (alembic-in-CI pattern)

**Authoritative playbook: read `/workspace/extra/wiki/operations/ci-db-migrations.md`**
(shared wiki mount — apps/sre/support containers; if missing in yours, say so and cite
the page path).

Trap list:

- Run migrations as a **single in-cluster Job** via `az aks command invoke` (DBs are private) — never per-pod at startup (race).
- **Gate the image-tag bump on the migration Job succeeding** (migrate → then gitops-update), so a failed migration blocks the deploy instead of shipping a mismatched image.
- Expand/contract invariant: the previous image must still run against the migrated schema.
- **Stamp/upgrade from the NEW image** (the one carrying the revisions), not from main — env branches can carry unreleased migrations (bit agent-x).
- Sentinel/`wait -n`/version-drift gotchas + the port-to-another-repo checklist are on the page. First shipped for agent-x (workflows PR #186).
