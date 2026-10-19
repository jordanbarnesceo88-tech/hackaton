# Isolated twelve-worker recovery check

The current `scripts/check-queue-recovery.mjs` replaces the historical loopback-only
recovery runner. It does not rerun or alter the archived da53b43 evidence. This is a
separate destructive failure experiment, never part of the timed HTTP burst.

Only run after explicit coordinator approval, after the load run has finished and
the dedicated queue is empty. The only deployment is the same declared
`alfa-queue-scaled-20261019`: HTTP3087, PostgreSQL127.0.0.1:55440/alfa_queue_scaled,
explicitly declared12 or14 existing workers, matching database cap, worker pool2.
Set `QUEUE_LOAD_WORKERS` to exactly `12` or `14`; it must match the finished load
and current policy/startup/resources. Read the [load declaration
contract](./README.md) first. The same exact engine, image IDs, profile, catalogue,
host/VM facts and per-container resources are required. Database query routing
overrides and all other targets fail before connecting.

Keep the load runner's environment declarations. Set these additional variables:

| Variable | Meaning |
|---|---|
| `QUEUE_RECOVERY_GO` | `RUN`, only after explicit approval for SIGKILL |
| `QUEUE_RECOVERY_LOAD_DIR` | Completed current load-run directory outside the repo |
| `QUEUE_RECOVERY_EXPECT_LOAD_REPORT_SHA256` | Predeclared SHA256 of its exact report.json |
| `QUEUE_RECOVERY_REPORT_DIR` | New empty external directory; existing evidence is rejected |

```sh
node scripts/check-queue-recovery.mjs --help
npx vitest run --project unit scripts/queue-load/recovery.test.mjs --maxWorkers 1
# Only after declarations and approval:
node scripts/check-queue-recovery.mjs
```

The runner reads that load run's pinned `fixed-request.json` and verified reference
receipt. It preserves the request's facility, parameters and full scenarios, changing
only the operation to CREATE and adding a synthetic project name. It does not draw
inputs from an old submission package or manufacture a capacity result. A load FAIL
is admissible only with a verified functional/compute reference; recovery does not
upgrade that FAIL to an SLA PASS.

One synthetic owner submits exactly one POST. After SQL confirms RUNNING attempt1,
the runner revalidates all and only the declared workers and sends real SIGKILL to their
immutable container IDs. It requires exit137 and an unfinished first attempt. It
observes health and PostgreSQL-clock lease expiry without changing the lease or
using the cancellation API. It starts the same twelve IDs, then requires SUCCEEDED
attempt2, the same job/run/frozen input/hash/engine/reserved project, one published
revision0 project and exactly one run/job/submission for that owner.

The real result must agree between HTTP, CalculationRun and Project. The current
capacity/safety contract, N6/C2, nominalPARTIAL51.5 and separate controlled55/54.5,
catalogue signature and financial metrics must match the pinned reference. App and
database must not restart; worker identities, images and resource limits must not
change. All declared source/request/resource bytes are checked again afterward.

Successful and failed fixtures are retained. Passwords, cookies, DSNs, container
environment and raw worker logs are excluded from reports. If the check fails
after killing workers, it attempts to restore only those same verified IDs and
records that action while keeping FAIL. It never scales or recreates containers.
Use recovery-report.json and recovered-result.json as separate scoped evidence;
202 admission, health availability or a correct restart alone cannot produce PASS.

Before fixture writes, immediately before SIGKILL and after restart, the runner
also verifies the exact single app port, project network ID, database `db` alias,
all fourteen service IDs and absence of additional network members. A worker IP
may change on restart; its container ID, network ID, aliases and resources cannot.
An idle PostgreSQL pool error is recorded without a raw exception or immediate
process exit. It prevents PASS and returns control to the restoration path.
