---
name: agentx-tenant-alerting
description: Use when an agent-x run-failure alert fires in Slack, or when a tenant must be added / re-tiered / silenced in agent-x prod alerting (DEVOPS-725 / spec 027 pipeline).
---

# agent-x tenant alerting

**Authoritative runbook: read `/workspace/extra/wiki/operations/agent-x-tenant-alerting.md`**
(shared wiki mount — apps/sre/support containers; if missing in yours, say so and cite
the page path).

Key facts:

- Every failed prod agent-x run (incl. reaped/stuck) emits one structured log event **`agentx_run_failed`**: tenant, agent, caller (studio / aquant_ai / unknown), error type, scrubbed message (≤300 chars), **tenant_tier**, and a Studio Admin deep link (`/admin/runs?run=<invocation_id>`).
- Groundcover monitors on that event route to Slack by tenant tier — add / re-tier / silence a tenant per the page's steps.
- Deep-dive a specific run through the deep link (Studio Admin runs view) before touching alert config.
- As-built history: `AquantIO/agent-x` `specs/027-alert-notification-enrichment/plan.md` §17 and `/workspace/extra/wiki/operations/monitoring.md`.
