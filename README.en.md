# homepub

Publish self-hosted services to the internet with one command: generate and verify the `frp + nginx + ACME` chain.

[中文](README.md) | English

```
browser --HTTPS(443)--> nginx on the public server --HTTP--> 127.0.0.1:18081
                                                                |
                                                        frps <--+-- frpc (home server)
                                                                |
                                                        127.0.0.1:8090 your service
```

## The problem

Exposing a homelab service means editing three places by hand: `frpc.toml` (service, local port, tunnel port), `frps.toml` (token, allowed port range) and nginx (server block, certificates, renewal). Something always gets missed: port 18081 is already taken, a certificate expired, a service died silently, or a machine migration has to be rebuilt from memory.

homepub keeps one JSON file as the source of truth and generates all three, plus a stable port ledger and a one-command health check.

## What it does NOT do

- No servers, domains or compliance paperwork.
- No hosting and no touching of your running data.
- No frps deployment; it generates a snippet (or a full example file).
- Not 24/7 monitoring. `doctor` is a point-in-time check.
- It never edits production config automatically: files + install scripts with backups and rollback, then a human step.

## Quick start

Requires Node.js ≥ 22, an existing frps/frpc setup and `acme.sh` on the public server.

```bash
git clone <repo> && cd homepub
node bin/homepub.js init
# edit domain / server.addr / services
node bin/homepub.js plan
export FRP_TOKEN='same token as frps'
node bin/homepub.js apply

sudo bash out/client/install.sh   # home server: backs up, aborts on placeholder token
sudo bash out/server/install.sh   # public server: HTTP bootstrap -> ACME -> HTTPS, rolls back on failure
node bin/homepub.js doctor        # ports, DNS, HTTPS, certificate days left (full TLS validation)
```

`install.sh` installs an HTTP-only bootstrap site first (port 80 + ACME challenge, everything else 503), issues certificates, then swaps in the HTTPS sites. A failing `nginx -t` rolls the whole change back.

## Commands

| command | purpose |
| --- | --- |
| `init [dir]` | create a starter config |
| `plan` | show create/update/remove + port allocation (read-only) |
| `apply` | write `out/` and the ledger |
| `status` | print the port ledger |
| `doctor` | check local ports, DNS, HTTPS and certificate expiry |
| `help` | usage |

Flags: `--config`, `--out`, `--token`, `--force`, `--prune`, `--json`.

## Security notes

- Token only lands in `frpc.toml` (600); `out/` is git-ignored.
- `frps` must set `proxyBindAddr = "127.0.0.1"` **before the first [table]** (or use `server/frps.toml.example`), otherwise tunnel ports fall back to 0.0.0.0.
- Open only 443, 80 and 7000/tcp.
- `install.sh` keeps a `.homepub-managed` manifest, so removed services get their old vhost cleaned up.

## Support

Tips: link to be added after launch (see `docs/SUPPORT.md`). Sponsorship (logo + consulting): open an issue.

## License

MIT
