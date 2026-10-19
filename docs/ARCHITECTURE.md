# Architecture and design decisions

## Data flow

```
homepub.config.json          (single source of truth, committed)
        |
        +-- plan.js ---------> in-memory files: frpc.toml, nginx/*.conf, acme.sh, install.sh, frps snippet
        |                      ports assigned here (stable via ports.json)
        v
      out/  -----------------> copied to home server (client/) and public server (server/)
        |
        +-- doctor.js --------> TCP / DNS / HTTPS checks (read-only, no writes)
```

## Decisions

### 1. Generate, never mutate

Editing live config is where tools become dangerous: partial writes, unknown prior state, no rollback. homepub only writes files into `out/`. The generated install scripts back up the target, run `nginx -t`, reload, and print a rollback hint. The production change is a deliberate human step.

### 2. Port ledger lives outside `out/`

`out/` is disposable: it may be deleted, re-cloned, or built on another machine. If tunnel port assignment lived there, deleting it would reshuffle ports, and every DNS/firewall record would silently break. So the ledger is `paths.ledger` (default `./ports.json`) and is designed to be committed. `assignPorts()` keeps existing entries and only allocates for new services.

### 3. TCP tunnel + nginx TLS, not frp's `type = "http"`

frp can terminate HTTP itself (`type = "http"` with `customDomains`), but then each frpc needs certificates, TLS settings are duplicated, and HTTP/2 / access logs / headers live in two places. With a TCP tunnel:

- certificates and TLS policy exist in exactly one place (nginx on the public server);
- the public server is the only thing listening on 443;
- frps only sees encrypted bytes on loopback-bound ports;
- WebSocket and HTTP/2 work because nginx handles them.

The cost is one extra hop through nginx — irrelevant at homelab scale.

### 4. `proxyBindAddr = "127.0.0.1"`

Tunnel ports are an implementation detail. If frps binds them on `0.0.0.0`, anyone can hit `http://ip:18081` directly, bypassing TLS and nginx. The generated frps snippet binds them to loopback and restricts the range with `allowPorts`.

### 5. Doctor uses injected checks

`runDoctor()` accepts `checkPortFn` / `checkDnsFn` / `checkHttpsFn` so tests never hit the network. DNS is only considered healthy when it resolves to `server.addr` — a common failure is a stale A record.

## Modules

| file | responsibility |
| --- | --- |
| `src/config.js` | parse + validate JSON, fill defaults, normalize services |
| `src/plan.js` | port assignment, assemble every output file |
| `src/render.js` | pure string builders (frpc TOML, nginx, shell scripts, ledger) |
| `src/apply.js` | diff against disk, write only changed files, chmod |
| `src/doctor.js` | TCP / DNS / HTTPS / certificate checks |
| `src/cli.js` | argument parsing, command dispatch, table output |

## Testing

`node --test "test/**/*.test.js"` — 25 tests: config validation, port stability, deterministic rendering, idempotent apply, doctor with fakes.
