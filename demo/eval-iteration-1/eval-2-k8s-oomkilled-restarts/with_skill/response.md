## Short version

Your app isn't crashing by itself. The Linux kernel kills it about every 20 minutes for going over its memory limit, and Kubernetes then restarts it in the same pod. Here's what in your paste shows that:

- `Last State: Terminated · Reason: OOMKilled · Exit Code: 137`: 137 is 128 + 9, meaning it got SIGKILL (`kill -9`) for going over `Limits: memory: 512Mi`.
- `Restart Count: 14` since `Start Time: 08:02`: that's one death roughly every 20 min. The last run lasted from 12:19 to 12:41.
- Config smell: `NODE_OPTIONS=--max-old-space-size=1024` lets V8 grow its heap to **1 GB**, but the container is capped at **512 MiB**. More on why that matters below.
- The pod was created at 08:02 this morning, which is also when the restarts started. That looks like a deploy of `2.14.0`.

That tells us what's killing it. What we don't know yet is *why* memory reaches 512Mi every ~20 min. First, stop the bleeding.

## Do now (~5 min)

I can't reach your cluster, so you'll need to run these yourself. I'm assuming the Deployment is called `orders-api`; `kubectl -n prod get deploy` will confirm.

```bash
# 1. Save evidence first: a rollback replaces the pods and this is gone
kubectl -n prod logs orders-api-7d9f8b6c5-x2kqp --previous > orders-api-prev.log
kubectl -n prod get pods -l app=orders-api          # RESTARTS column: all replicas, or just this one?

# 2. Did something ship this morning?
kubectl -n prod get rs -l app=orders-api -o wide    # one ReplicaSet per version: IMAGES + AGE
```

- `--previous` gets the logs of the container that *died*. Plain `kubectl logs` shows the fresh run, which will look fine.
- Two things mean 2.14.0 rolled out at 08:02: an older ReplicaSet with a different image, and `orders-api-7d9f8b6c5` being about 4h40m old.

Then pick one:

- **2.14.0 went out this morning:** run `kubectl -n prod rollout undo deployment/orders-api`. Why: it goes back to the last version that didn't do this, which is the fastest and safest fix. You can debug 2.14.0 afterwards without the pressure.
- **Nothing shipped, or the rollback didn't help:** in your deploy config (Helm values or YAML), raise `limits.memory` to `1Gi` and set `NODE_OPTIONS=--max-old-space-size=768` (about 75% of the limit). Why: it adds headroom and puts V8's ceiling *inside* the container's ceiling. If there's a real leak, this only stretches 20 min to maybe 45. It's a stopgap, not the fix.

If your deploys go through CI, Helm or GitOps (Argo CD, Flux), roll back or change things there. A manual `kubectl` edit gets overwritten on the next deploy or sync. We'll fix the 1024-vs-512 mismatch properly either way.

## What this task needs

**You already know:** Node processes and the V8 heap (`--max-old-space-size`, "heap out of memory"), HTTP health endpoints, in-memory caches with TTLs, Unix signals and exit codes.

**You're missing:**
- The difference between a container restart and a pod replacement, and how to read `describe` (**concept + API**: kubectl)
- Memory requests vs. limits, and what OOMKilled / exit 137 means (**concept** · fundamental: operating systems)
- Liveness vs. readiness probes (**concept**)
- Why memory hits 512Mi every ~20 min (**behavior**: this needs evidence, not an explanation)
- Where the orders cache lives and whether it has a size cap (**codebase**: it's in your repo, which I don't have)

A note on fundamentals: cgroups, the OOM killer, SIGKILL vs. SIGTERM, and RSS vs. heap are operating-system basics. Today's model is enough to read this incident. It's too thin to tell you when an answer about memory in general is wrong. Worth studying later: "Linux cgroup memory limits" and "Node.js memory: heap vs. RSS".

## Minimum model

```text
Deployment orders-api ──manages──▶ ReplicaSet orders-api-7d9f8b6c5 ──keeps N of──▶ Pod …-x2kqp
                                                                                     │ contains
                                                                                     ▼
                                                        Container orders-api (your node process)
                                                                  │ exits / gets killed
                                                                  ▼
                                   kubelet restarts it IN THE SAME POD → Restart Count +1
                                   (same pod name and IP; repeated deaths → BackOff delays)

If the Pod itself is deleted, the ReplicaSet makes a NEW pod (new name, count back to 0).
```

```text
limits.memory 512Mi   enforced by the Linux kernel (cgroup) on EVERYTHING in the container
┌────────────────────────────────────────────────────────────────┐
│ node process (RSS)                                             │
│   V8 heap: NODE_OPTIONS says "you may grow to 1024 MB"  ◀── bigger than its box
│   + Buffers, native modules, compiled code, thread stacks …    │
└────────────────────────────────────────────────────────────────┘
requests.memory 256Mi  = what the scheduler reserves on a node; not a cap
```

- **Anchor:** the container limit works like `--max-old-space-size`, except the kernel enforces it from *outside*, on the whole process.
- **Where the analogy breaks:** when V8 hits its own cap, you get a clear `FATAL ERROR … JavaScript heap out of memory` in your logs (exit 134). The kernel gives no warning. It sends SIGKILL, so you get no error, no `process.on('exit')` and no graceful shutdown, and in-flight requests just drop.
- V8 thinks it has 1 GB, so it has no reason to run an expensive full GC at 450 MB. It can blow past 512Mi while still feeling "comfortable".
- **Probes:** if **liveness** fails 3 times in a row (`#failure=3`), the kubelet restarts the container. If **readiness** fails, the Service stops sending the pod traffic, but the pod keeps running.

I left out QoS classes, node-level memory pressure/eviction and autoscaling on purpose. They exist, but this bug doesn't need them.

**How to read a `describe` next time, in this order:**
1. **`Last State` → `Reason` + `Exit Code`:** how did the last run die? `OOMKilled`/137 means it hit the memory limit. `Error`/1 means your code threw, so read `logs --previous`. `Error`/143 means it got SIGTERM: a shutdown or a liveness kill. This only covers the *most recent* death. The other 13 aren't shown.
2. **`Restart Count` + `Start Time` + `Started`/`Finished`:** how often, since when, and is it a steady rhythm or random?
3. **`Limits` / `Requests` / `Environment`:** what box is the app in, and does its config fit that box?
4. **`Events`:** what the kubelet saw and did (probe failures, BackOff, image pulls, scheduling).

After that, `kubectl logs --previous` shows the dead container's last words.

## Hypotheses: why does it reach 512Mi every ~20 min?

- **H1 · Something only ever grows (an unbounded cache or a leak).** The suspect is `ORDERS_CACHE_TTL_S=3600`. Say that cache expires entries after an hour but has no max size. Then in a pod that lives 20 min, *nothing ever expires*, and the cache just grows with traffic.
  → **Memory graph:** a steady climb from each restart up to 512Mi, then a drop (a sawtooth), steeper at busy times. A heap snapshot is dominated by one Map or object.
- **H2 · No real leak, just the heap-flag mismatch.** The live data is modest, but V8 thinks it has 1 GB, so it lets garbage pile up past 512Mi.
  → **Memory graph:** it also climbs. The difference: a heap snapshot (which forces a full GC) is far smaller than the container's memory. Setting `--max-old-space-size` below the limit makes memory level off.
- **H3 · A spike: one kind of request loads something huge** (an unpaginated order list, a big export).
  → **Memory graph:** flat-ish, then a sudden jump right before each kill. The kills line up with specific requests, not a steady clock.

Separately, if 2.14.0 shipped this morning, the diff against the previous version is where H1 or H3 would be hiding.

## Your turn

One line each is plenty, or say "skip" and I'll carry on.

1. **Read:** a teammate suggests raising the liveness `timeout` from 1s to 10s "to stop the restarts". Based on your paste, would that help? And why do you think `/healthz` stops answering within 1s in the first place?
2. **Predict:** before you look at the memory graph, which of H1–H3 do you lean toward? What shape do you expect the line to have across one ~20-minute life? For the graph, use container memory for orders-api over the last 4h in whatever dashboard you have (Grafana, Datadog, CloudWatch). If you have none, run `kubectl top pod` a few times, a minute apart; it needs metrics-server installed.

Then send me your answers, the `get rs -o wide` output and the last ~30 lines of `orders-api-prev.log`. Next we'll check your predictions against the evidence, pin down the cause and make the real fix.
