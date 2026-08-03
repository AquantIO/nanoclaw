---
name: seed-private-keyvault
description: Use when a secret must be created/updated in a firewalled (private-endpoint) Azure Key Vault — e.g. seeding a new app's KV, repointing an endpoint secret, rotating a key — and there is no VPN. Runbook = in-cluster Job on the app's workload identity.
---

# Seed/update a private Key Vault without VPN

**Authoritative runbook: read `/workspace/extra/wiki/operations/secret-management.md`**
(section: "update/seed a private KV without VPN"; shared wiki mount — apps/sre/support
containers; if missing in yours, say so and cite the page path).

Trap list:

- All scop vaults are firewalled **including dev** — `az keyvault secret set` from outside fails; run an `azure-cli` Job **inside the cluster** using a workload identity that can reach the vault's private endpoint.
- **Check whether the app's MI is already `Key Vault Secrets Officer` first** — often no temp grant is needed; if you do grant one, remove it after.
- **Always pin `--subscription`** on every az call in the Job.
- Deliver the secret value into the Job without leaking it (no plain args in the pod spec; see the page's pattern).
- After writing: ExternalSecrets sync ~2min; force-sync + rollout if the pod must pick it up now. When a chart PR adds a NEW vault key, seed the vault **before** merging the chart (ESO can fail the whole ExternalSecret on a missing remote key).
- If you granted a role in step 1, add a role-propagation retry loop in the Job — the grant is not instant.
