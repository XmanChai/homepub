# homepub

Publish self-hosted services to the internet with one command: generate and verify the `frp + nginx + ACME` chain.

中文 | [English](README.md)

```
browser --HTTPS(443)--> nginx on the public server --HTTP--> 127.0.0.1:18081
                                                                |
                                                        frps <--+-- frpc (home server)
                                                                |
                                                        127.0.0.1:8090 your service
```

## The problem

Exposing a homelab service means editing three places by hand: `frpc.toml` (service, local port, tunnel port), `frps.toml` (token, allowed port range) and nginx (server block, certificate paths, renewal). Sooner or later:

- nobody remembers which of 18081–18099 is taken, and a new service collides;
- a certificate expires because renewal was configured once;
- a service dies silently until someone says "it's down";
- migrating machines means rebuilding config from memory.

homepub keeps one JSON file as the source of truth and generates all three, plus a stable port ledger and a one-command health check.

## What it does NOT do

- It does not buy servers/domains or handle compliance.
- It does not host your services or touch your data.
- It does not deploy frps itself; it generates a snippet to append.
- It is not 24/7 monitoring. `doctor` is a point-in-time check.
- It never edits production config automatically: it writes files plus install scripts that back up and reload.

## Quick start

Requires Node.js ≥ 22 and an existing frps + frpc setup.

```bash
npx homepub init                 # write homepub.config.json
# edit domain / server.addr / services
npx homepub plan                 # show files and tunnel port allocation (read-only)
export FRP_TOKEN='same token as frps'
npx homepub apply                # write out/ and update ports.json

sudo bash out/client/install.sh  # on the home server
sudo bash out/server/install.sh  # on the public server (after appending frps-snippet.toml)
sudo bash out/server/acme.sh     # issue certificates (acme.sh renews them)
npx homepub doctor               # local ports, DNS, HTTPS, certificate days left
```

## Commands

| command | purpose |
| --- | --- |
| `homepub init [dir]` | create a starter config |
| `homepub plan` | show what would change (no writes, no network) |
| `homepub apply` | write `out/` (only changed files) and update `ports.json` |
| `homepub status` | print the port ledger |
| `homepub doctor` | check local ports, DNS, public HTTPS and certificate expiry |
| `homepub help` | usage |

Flags: `--config <path>`, `--out <dir>`, `--token <token>`, `--force`, `--json`.

## Security notes

- The token only lands in `frpc.toml` (mode 600); `out/` is git-ignored.
- `out/server/frps-snippet.toml` sets `proxyBindAddr = "127.0.0.1"` so tunnel ports are never reachable from the internet directly. Do not skip it.
- Open only 443, 80 (ACME) and 7000/tcp.
- Generated nginx sites include HTTP→HTTPS redirect and WebSocket support.

## Support

- Afdian (tips): <https://afdian.com/a/yourname> (placeholder)
- Sponsorship (logo + consulting): open an issue.

Tips are voluntary and do not come with an SLA.

## License

MIT
