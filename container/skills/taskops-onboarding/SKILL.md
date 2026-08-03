---
name: taskops-onboarding
description: Use when migrating an app or adding a new task type onto TaskOps (Celery→TaskOps, new ScaledJob worker, new Service Bus queue), or when a TaskOps worker/queue misbehaves right after such a migration. Cross-repo playbook spanning iac + helm-charts + flux + workflows + the app repo.
---

# TaskOps onboarding / migration

**Authoritative playbook: read `/workspace/extra/wiki/operations/taskops-onboarding.md`**
(shared wiki mount — available in the apps/sre/support agent containers; if the mount is
missing in yours, say so and cite the page path instead of guessing).

Trap list (the recurring time-sinks — details and full RBAC model on the page):

- **New/dedicated Service Bus namespace ⇒ taskops-api needs `Azure Service Bus Data Owner` on it** (not just Sender — cancel/delete/DLQ need receive+manage). This is the #1 recurring miss.
- Workers get `Data Receiver` on their own namespace only.
- **The worker UAMI is created in `iam/managed-identities`, NOT in `roles-assignments`.**
- **Session-enabled queues require a per-item `sessionId`** on every enqueued message.
- The shared `taskops/taskops` grant module is all-or-nothing across co-tenant namespaces.
- Use in-cluster addresses only; 1 task type : 1 queue (shared queues retired 2026-07-13).
- `groupId` must be a UUID — non-UUID 400s at submit.
