# Controlled-capacity queue load check

This runner measures one fixed deployment. It does not build images, create a
Docker stack, migrate or seed the database, change the queue policy, scale workers,
or clean up fixtures. Prepare and independently review the deployment first. Run
the benchmark only after the coordinator explicitly permits it.

```sh
node scripts/queue-load/run.mjs --help
npx vitest run --project unit scripts/queue-load --maxWorkers 1
```

The tests use in-memory transports and SQL. Help and rejected preflight commands
do not connect to Docker, HTTP or PostgreSQL.

## Fixed deployment and declarations

The only allowed project is `alfa-queue-scaled-20261019`, with HTTP
`http://127.0.0.1:3087` and PostgreSQL at `127.0.0.1:55440/alfa_queue_scaled`.
The database container must publish `127.0.0.1:55440` to its port 5432. App and
workers use the same project's internal `db:5432/alfa_queue_scaled` without URL
query overrides. Other ports, names, routing queries and URL fragments fail closed.

Explicit `QUEUE_LOAD_WORKERS` must be exactly `12` or `14`, with no default.
There must be exactly that many running `worker` containers and one `app` container.
The real `CalculationQueuePolicy` singleton must contain `id=1,maxActive` equal to
the declared worker count. Each current worker startup must record
`concurrency=1`, `globalCap` equal to that same count,
`dbPoolMax=2`, `policy=database` and the declared full engine identity.
The harness uses a separate pool of two connections. Changing environment labels
does not change or substitute for the real database policy.

Set the following variables in the process environment. Keep the database
credentials in memory. Do not save them in this directory or include them in logs.

| Variable | Required value |
|---|---|
| `QUEUE_LOAD_GO` | `RUN`, only after explicit coordinator approval |
| `QUEUE_LOAD_PROJECT` | `alfa-queue-scaled-20261019` |
| `QUEUE_LOAD_ORIGIN` | `http://127.0.0.1:3087` |
| `QUEUE_LOAD_WORKERS` | Exactly `12` or `14`; worker count and database cap must match |
| `DATABASE_URL` | Private connection to the exact isolated endpoint above |
| `QUEUE_LOAD_EXPECT_ENGINE` | Exact freshly built `alfa-robot/sha256:` fingerprint |
| `QUEUE_LOAD_EXPECT_JOB_ENGINE` | Exact full fingerprint with its deployment suffix |
| `QUEUE_LOAD_EXPECT_APP_IMAGE` | Immutable app `sha256:` image ID |
| `QUEUE_LOAD_EXPECT_WORKER_IMAGE` | Immutable worker `sha256:` image ID |
| `QUEUE_LOAD_PROFILE` | Explicit path to the externally prepared JSON profile |
| `QUEUE_LOAD_EXPECT_PROFILE_SHA256` | SHA256 of those exact profile bytes |
| `QUEUE_LOAD_EXPECT_RESOURCES_FILE` | Explicit external JSON resource declaration |
| `QUEUE_LOAD_EXPECT_RESOURCES_SHA256` | SHA256 of those exact declaration bytes |
| `QUEUE_LOAD_REPORT_DIR` | New empty directory outside the repository |

After those declarations and approval, the command is:

```sh
node scripts/queue-load/run.mjs
```

An exclusive `run-owner.json` prevents two invocations from overwriting the same
run directory. Existing evidence is never reused or removed. The output path must
remain outside the repository even through a directory link.

## Profile prepared before the run

Use schema `stage3-load-profile-1`. Supply `versions` with `economics`, `analytical`
and `spatial`; `initial` with canonical `facility`, `params` and three scenarios;
and `declaredCase` with `fleet:6`, `chargers:2`, `seed:1`,
`requiredPerH:51.81818181818182` and `sourceInputKeySha256`.

`sourceInputKeySha256` is the digest of the real canonical source identity, not of
the execution geometry or controlled-demand input. Compute `catalogueSha256` from
the fresh isolated catalogue/norm/parameter-definition snapshot using
`catalogueSignature(live)` from `declaration.mjs`. It hashes canonical JSON for
`{products:live.products,norms:live.norms,paramDefs:live.paramDefs}`. Use the same
current source release and freshly seeded data. Renaming an old profile's schema
does not make its frozen catalogue current.

After GO, the runner first obtains one real public nominal calculation outside
the measured phases. It preserves that server response's scenarios and requests
controlled capacity through `requestCapacityScenarios`; it does not fabricate a
positive receipt or replace financial inputs. The actual canonical input digest
must equal the declaration. The exact accepted request is then frozen for every
owner and saved as `fixed-request.json`. Each stored `CalculationRun.input` must
retain that request and its declared catalogue snapshot.

The case remains N6/C2: ordinary nominal `PARTIAL`, 51.5 delivered per hour against
51.818..., separately controlled 55 delivered / 54.5 closed cycles per hour with
the fixed cohort protocol. A positive purchase NPV is checked separately. Changes
to seed, goal, input fields, finances or proof identities fail verification.

## Resource declaration

Use schema `stage3-load-resources-1`. Before the first request declare:

- `host`: exactly `cpuModel`, `logicalCpu`, `ramBytes` from the client host.
- `docker`: exactly `cpus` and `memoryBytes` from the Docker daemon's `NCPU` and
  `MemTotal`. Host RAM and Docker VM RAM are separate observations.
- `containers`: the thirteen exact app/worker names mapped to selected Docker
  `HostConfig` fields: `NanoCpus`, `CpuPeriod`, `CpuQuota`, `CpuShares`,
  `CpusetCpus`, `CpusetMems`, `Memory`, `MemoryReservation`, `MemorySwap`,
  `PidsLimit`. Include every field. Zero limits explicitly mean unlimited within
  the Docker host; they do not mean a production resource budget was proven.
- `database`: the immutable database image ID as `image` plus its same selected
  `limits` fields. The database container is inspected separately.

The runner reads container identities, images, start times, source manifests,
resource limits and worker startup claims. These, the host/VM declaration,
profile bytes, runner/helper bytes and local executable source graph are checked
again after the run. The actual database policy is read before and after and in
every SQL-clock lease sample. The database process identity must also remain
unchanged. A mismatch is a failed run, not permission to retune and continue.
The single inspected app must publish exactly loopback3087 to port3000. All
fourteen services share only the same project network; it must contain exactly
their inspected IDs and names. Only the inspected database may have the `db`
alias. A spare app or different network cannot stand in for the HTTP target.

## Measurements and retained evidence

Create 53 distinct synthetic users, authenticate each independently, and finish
all authentication before the measured phases. Run one reference, two smoke
clients, then one simultaneous 50-client burst. Do not retry the initial POST.
The result includes every first status: 202, 429, unexpected 5xx, transport error
and response decoding error are different outcomes. Parsed result timing starts
before the first POST and ends after result JSON decoding. Independent database
verification happens afterward and is excluded from that client duration.

For every accepted result, verify owner/job/run, engine, attempt=1, cleared lease,
stored input and full stored result against HTTP. Verify the canonical source,
controlled executor/protocol/cohorts and financial signature against the real
reference. Preserve all raw receipts and their SHA256, including a receipt that
later fails verification. SQL computes queue and compute/store durations using
database timestamps; no client timezone conversion supplies those durations.

All earlier timing thresholds remain:

| Criterion | Bound |
|---|---|
| First accepted POSTs / stored verified results | 50/50, each attempt=1 |
| Compute plus store, every job | 60 seconds |
| POST through parsed result, every client | 60 seconds |
| ACK | p95 ≤10 seconds, maximum <30 seconds |
| Health and poll | p95 ≤1 second, maximum <3 seconds |
| Drain cutoff / POST timeout | 600 / 30 seconds |
| Poll interval / SQL lease sampling | 1000 / 250 ms |

The declared maximum valid lease count changes to twelve for this deployment;
the run must observe its use and must never observe an excess. A 202 alone is
not a successful calculation. Durability, compute60, clientResult60 and
responsiveness remain separate verdicts; overall PASS requires all four.
FAIL returns exit code 1 and stays in its new run directory. Keep failed runs,
fixtures and pending work for review; do not delete, cancel or silently rerun them.

The report contains hardware facts, selected container facts, relative source
hashes and synthetic IDs. It excludes passwords, cookies, connection strings,
raw container environment, raw worker logs and the personal host name. Errors
use safe name/code fields. This HTTP/SQL test does not validate browser rendering,
natural-site calibration, recovery after failure or a universal service level.
