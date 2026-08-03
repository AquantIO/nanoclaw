---
name: qdrant-backup-restore
description: Use when a qdrant (voiceai vector DB) backup must be triggered manually, a collection restored, snapshots verified, or a qdrant data-loss/DR question comes up. Verified runbooks via in-cluster Job — no SAS, no VPN.
---

# Qdrant backups & restore (voiceai)

**Authoritative runbooks: read `/workspace/extra/wiki/operations/qdrant-backups.md`**
(shared wiki mount — apps/sre/support containers; if missing in yours, say so and cite
the page path).

Trap list:

- A backup run is only trustworthy if **every shard-holding pod succeeded that run** — collections are split across pods.
- **web-voiceai garbage-collects orphan collections after any qdrant restart** — a restored-but-not-registered collection can be dropped (happened 2026-07-29).
- The qdrant API key exists **only in-cluster and does NOT match the vault** copy.
- New collections are born `replication_factor=1` unless the server-side chart default (`storage.collection.replication_factor: 2`) is intact — the app never passes it.
- Snapshot CronJob: 6-hourly prod / daily dev → GRS blob, 30d retention; restore and DR-restore-into-wus paths are on the page.
- The azure-cli image has no `awk` — scripts relying on it fail silently.
