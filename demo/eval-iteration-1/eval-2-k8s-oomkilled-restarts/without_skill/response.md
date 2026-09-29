**Short version:** your code isn't crashing. The Linux kernel is killing the container because it goes over its **512Mi memory limit**, and it does that about every 20 minutes. A config mismatch makes it worse: `NODE_OPTIONS` lets Node's heap grow to **1024 MB** inside a container that's only allowed 512Mi in total. The probe failures you're seeing are a symptom of this, not the cause.

Below I go through how I read your describe output, then what to do now, then a checklist you can reuse next time.

---

## Reading the describe output

When a pod keeps restarting, read `describe` in this order.

### 1. `Last State`: why did the last container die?

```
Last State:     Terminated
  Reason:       OOMKilled
  Exit Code:    137
  Started:      12:19:02
  Finished:     12:41:35
```

This is the most important block. `State` is the current container, which is running and healthy because it just restarted. `Last State` is the one that died.

- **`OOMKilled`**: the kernel killed the process for going over the container's memory limit.
- **Exit code 137** = 128 + 9, meaning it got SIGKILL. The process gets no warning, so there's no stack trace, no "out of memory" line in your logs and no graceful shutdown. Any requests that pod was handling just fail.
- **It lived 22m33s.** 14 restarts since 08:02 works out to one every ~20 minutes. A steady rhythm like that means memory climbs steadily until it hits the ceiling. A single bad request causing a spike would look different.

### 2. `Limits` / `Requests`: where's the ceiling?

```
Limits:    memory: 512Mi      Requests:  memory: 256Mi
```

- **Request** is what the scheduler reserves on a node when it places the pod.
- **Limit** is a hard ceiling the kernel enforces. Going over the *memory* limit gets the process killed. Going over the *CPU* limit only slows it down (throttling).

### 3. `Environment`: the likely cause

```
NODE_OPTIONS:        --max-old-space-size=1024
ORDERS_CACHE_TTL_S:  3600
```

- `--max-old-space-size=1024` tells V8 it may let the heap grow to about 1 GB before it has to work hard at garbage collection. The container can only use 512Mi in total, and the JS heap is only part of the process's memory: Buffers, native code and thread stacks come on top of it. So V8 never feels any memory pressure and lets garbage pile up, and the kernel kills the process long before V8 would do a full cleanup. If the flag fit inside the limit, the worst case would be a Node `FATAL ERROR ... JavaScript heap out of memory` crash (exit 134) with a readable message, not a silent SIGKILL.
- `ORDERS_CACHE_TTL_S=3600` is my main suspect for *what* keeps growing. It looks like an in-process cache with a 1-hour TTL, but the container never lives an hour, so nothing in it ever expires. From the pod's point of view, that cache has no limit. I haven't seen your code, so treat this as a hypothesis to check.

### 4. `Events`: the timeline

```
Liveness probe failed ... context deadline exceeded    (x6 over 4h)
Readiness probe failed ... context deadline exceeded   (x9 over 4h)
BackOff   Back-off restarting failed container
```

The probes are timing out (their timeout is 1s), but they aren't what restarts the pod. If the liveness probe were killing it, you'd see a `Killing ... failed liveness probe, will be restarted` event, and `Last State` would say `Error`, not `OOMKilled`. What happens is that as memory nears the ceiling, V8 spends most of its time in garbage collection, the event loop stalls, and `/healthz` can't answer within 1s. **Don't try to fix this by loosening or removing the probes.**

`BackOff` means Kubernetes is waiting longer between restarts because the container keeps dying. It's the same thing `kubectl get pods` shows as `CrashLoopBackOff`.

### 5. `Start Time: 08:02:11`

This is when the *pod* was created, not when the current container started. A pod created at 8am on the day things broke usually means something was deployed at 8am. The image is `2.14.0` and the ReplicaSet hash is `7d9f8b6c5`. So the first question is: what changed this morning?

---

## What to do, in order

### 1. Find out what changed (about 5 minutes)

```bash
kubectl -n prod get pods -l app=orders-api           # are all replicas restarting, or just this one?
kubectl -n prod get rs -l app=orders-api -o wide     # old vs new ReplicaSets, with images and ages
kubectl -n prod rollout history deployment/orders-api
kubectl -n prod rollout history deployment/orders-api --revision=<N>   # full pod spec of revision N
```

If every replica is restarting, the problem is the app or its config, not a bad node. If the previous revision ran fine yesterday, compare its image, env vars (`NODE_OPTIONS`, `ORDERS_CACHE_TTL_S`) and memory limits with the current one.

### 2. Stop the bleeding

- **If 2.14.0 or a config change went out this morning and the version before it was stable, roll back.** It's the fastest and safest option. Use whatever you normally deploy with (CI, Helm, Argo CD). `kubectl -n prod rollout undo deployment/orders-api` also works, but if your cluster is managed through git (Argo CD or Flux), the change will be reverted to whatever git says. If you don't know how deploys happen, ask before you change anything by hand.
- **If nothing obvious changed, give the pods more memory and fix the heap flag at the same time**, in your deployment manifest or Helm values:
  ```yaml
  resources:
    requests: { cpu: 250m, memory: 512Mi }
    limits:   { cpu: 500m, memory: 1Gi }
  env:
    - name: NODE_OPTIONS
      value: "--max-old-space-size=768"   # ~75% of the memory limit
  ```
  Afterwards, check that the new pods actually get scheduled (`kubectl get pods`, look for `Pending`), because the bigger request needs room on a node. This buys time but doesn't fix a leak or an unbounded cache: pods would still die, just less often.

Fix `--max-old-space-size` either way. It should be about 75% of the container memory limit, which means ~384 at today's 512Mi.

### 3. Confirm the root cause

- **Graph memory over time.** Use whatever dashboards you have (Grafana, Datadog, CloudWatch Container Insights; look for container memory working set for orders-api), or poll it yourself if metrics-server is installed:
  ```bash
  while true; do kubectl -n prod top pod -l app=orders-api --containers; sleep 30; done
  ```
  A sawtooth that climbs steadily to ~512Mi and then drops means memory grows and never levels off, so a leak or an unbounded cache. A flat line with a sudden spike points to one specific request loading too much at once.
- **Read the logs of the container that died:**
  `kubectl -n prod logs orders-api-7d9f8b6c5-x2kqp --previous --tail=200`
  You won't find an OOM message there (SIGKILL gives no chance to log), but you'll see what the app was doing. Without `--previous` you get the fresh container's logs, which are usually no help.
- **See the mismatch for yourself** (a useful exercise). Run it soon after a restart, not when the pod is near its limit:
  ```bash
  kubectl -n prod exec orders-api-7d9f8b6c5-x2kqp -- node -e '
    console.log("V8 heap limit (MB):", require("v8").getHeapStatistics().heap_size_limit / 2**20);
    console.log("container limit (bytes):", require("fs").readFileSync("/sys/fs/cgroup/memory.max", "utf8"));
  '
  ```
  Expect about **1072 MB** for V8 against **536870912 bytes** (512Mi) for the container. If `memory.max` doesn't exist, the node uses the older cgroup v1 layout, so try `/sys/fs/cgroup/memory/memory.limit_in_bytes`.
- **Test the cache theory cheaply:** set `ORDERS_CACHE_TTL_S` to something like 300. It's a config change with no code change. If memory levels off and the restarts stop, you've found the culprit. The trade-off is more cache misses and therefore more database load, so watch that.
- **Check the code:** find where `ORDERS_CACHE_TTL_S` is read. Look for:
  - a `Map` or plain object used as a cache, with a TTL but no maximum size;
  - keys that can take almost any value (per order ID, per query string, per user);
  - large values, such as whole orders with their line items.

  The fix is to cap the cache by size, not just by time (for example `lru-cache` with `max`, or with `maxSize` + `sizeCalculation`). Also compare 2.13 with 2.14 for anything that touches the cache or other collections that live for the whole process.
- **If it's not the cache:** reproduce locally with `node --max-old-space-size=384 --inspect`, put load on it, and take 2–3 heap snapshots a few minutes apart in Chrome DevTools. The "Comparison" view shows which objects keep growing. It also helps to log `process.memoryUsage()` once a minute in prod:
  - `heapUsed` growing means JS objects are piling up;
  - `rss` growing while `heapUsed` stays flat means memory outside the heap (Buffers, native modules).

---

## A checklist for next time: "my pod keeps restarting"

1. `kubectl get pods`: look at the RESTARTS and STATUS columns.
2. `kubectl describe pod <pod>`: check **Last State → Reason + Exit Code** first. Then check limits and requests, probes and env, and the Events at the bottom.
3. `kubectl logs <pod> --previous`: the logs of the container that *died*.
4. `kubectl get events -n <ns> --sort-by=.lastTimestamp`: the wider timeline. Events are only kept for about an hour by default, so grab them early.
5. Memory and CPU over time: `kubectl top` or your dashboards.
6. What changed: `kubectl rollout history deployment/<name>` and `kubectl get rs -o wide`.

**Exit code cheat sheet**

| Last State shows | What happened | Usually means |
|---|---|---|
| `OOMKilled`, 137 | Kernel killed it for going over the memory limit | Memory growth, limit too low, or heap flag bigger than the limit |
| `Error`, 137 or 143, plus a `Killing ... liveness probe` event | Kubernetes restarted it after failed liveness checks | App hung or too slow to answer `/healthz` |
| `Error`, 134 (Node) | V8 hit its own heap limit | "JavaScript heap out of memory" in `logs --previous` |
| `Error`, 1 | App exited with an error | Uncaught exception, bad config, or DB unreachable at startup; check `logs --previous` |
| `Completed`, 0 | Process exited normally | The main process finished; nothing is keeping it running |

**Three things to remember**

- Requests are for scheduling; limits are enforced. Going over the memory limit gets you killed, going over the CPU limit gets you slowed down.
- A failed liveness probe means "restart me"; a failed readiness probe means "stop sending me traffic". When both time out together, the process is usually starved (GC, CPU throttling or a blocked event loop). Find out why instead of loosening the probes.
- For Node in a container, `--max-old-space-size` has to fit inside the memory limit with room to spare (about 75%).

---

**Caveats:** `Last State` only shows the *most recent* death. The other 13 are very likely the same, given the steady rhythm and the absence of liveness-kill events, but the memory graph will confirm it. I also haven't seen the service code or how you deploy, so the cache theory and "2.14.0 went out this morning" are inferred from the describe output alone.

If you paste the output of `get rs -o wide`, `rollout history` and `logs --previous`, or a screenshot of the memory graph, I'll help you read it. I can also turn the checklist into a one-page runbook for the team while your platform person is out.
