#!/usr/bin/env bash
# End-to-end check of the generated install scripts, using fake nginx/acme.sh/systemctl.
# Proves: two-phase install works, a failing "nginx -t" rolls back, placeholder tokens abort.
#
# Usage (Linux/WSL/Git Bash):
#   bash scripts/e2e-install.sh                        # generates output itself (needs node)
#   bash scripts/e2e-install.sh /path/to/out                 # reuse output generated elsewhere
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="${NODE:-node}"
TMP="$(mktemp -d -t homepub-e2e.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

if [ -n "${1:-}" ]; then
  OUT="$1"
  echo "== using pre-generated output: $OUT"
else
  OUT="$TMP/out"
  echo "== generating output"
  "$NODE" "$ROOT/bin/homepub.js" apply --config "$ROOT/examples/homepub.config.json" --out "$OUT" --token e2e-token --ledger "$TMP/ports.json" >/dev/null
fi

mkdir -p "$TMP/bin" "$TMP/conf.d" "$TMP/certs" "$TMP/acme-home"
export PATH="$TMP/bin:$PATH"
export CONF_DIR="$TMP/conf.d"
export CERT_DIR="$TMP/certs"
export NGINX_CONF_DIR="$TMP/conf.d"
export ACME_HOME="$TMP/acme-home"
export ACME_WEBROOT="$TMP/webroot"

cat > "$TMP/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

# nginx -t fails when a referenced certificate file is missing (paths are remapped
# from /etc/nginx/certs to $CERT_DIR so the test can run without root)
cat > "$TMP/bin/nginx" <<'EOF'
#!/usr/bin/env bash
[ "${1:-}" = "-t" ] || exit 0
[ "${FAKE_NGINX_FAIL:-0}" = "1" ] && { echo "nginx: [emerg] fake failure" >&2; exit 1; }
rc=0
while read -r f; do
  f="${f/#\/etc\/nginx\/certs/$CERT_DIR}"
  if [ ! -f "$f" ]; then
    echo "nginx: [emerg] cannot load certificate \"$f\"" >&2
    rc=1
  fi
done < <(grep -Rh "ssl_certificate " "$CONF_DIR" 2>/dev/null | sed -E 's/.*ssl_certificate[[:space:]]+([^;]+);/\1/' || true)
exit "$rc"
EOF

cat > "$TMP/acme-home/acme.sh" <<'EOF'
#!/usr/bin/env bash
key=""; pem=""
while [ $# -gt 0 ]; do
  case "$1" in
    --key-file) key="$2"; shift 2 ;;
    --fullchain-file) pem="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ -n "$key" ] && [ -n "$pem" ]; then echo key > "$key"; echo cert > "$pem"; fi
exit 0
EOF
chmod +x "$TMP/bin/nginx" "$TMP/bin/systemctl" "$TMP/acme-home/acme.sh"

echo "== phase 1+2: bootstrap -> acme -> https sites"
if ! bash "$OUT/server/install.sh" > "$TMP/install.log" 2>&1; then cat "$TMP/install.log"; exit 1; fi
grep -q "listen 443 ssl" "$TMP/conf.d/blog.example.com.conf" || { echo "expected HTTPS site after acme"; cat "$TMP/install.log"; exit 1; }
grep -q "blog.example.com" "$TMP/conf.d/.homepub-managed"

echo "== rollback: a failing nginx -t must restore the previous config"
mkdir -p "$TMP/conf.d2"
if CONF_DIR="$TMP/conf.d2" NGINX_CONF_DIR="$TMP/conf.d2" FAKE_NGINX_FAIL=1 bash "$OUT/server/install.sh" > "$TMP/rollback.log" 2>&1; then
  echo "install.sh should have failed"; exit 1
fi
grep -q "rolling back" "$TMP/rollback.log"
if ls "$TMP/conf.d2"/*.conf >/dev/null 2>&1; then echo "rollback left files behind"; exit 1; fi

echo "== acme.sh without the exec bit (scp without -p) must still switch to HTTPS"
chmod 644 "$OUT/server/acme.sh"
rm -rf "$TMP/conf.d3" "$TMP/certs3" && mkdir -p "$TMP/conf.d3" "$TMP/certs3"
CONF_DIR="$TMP/conf.d3" NGINX_CONF_DIR="$TMP/conf.d3" CERT_DIR="$TMP/certs3" bash "$OUT/server/install.sh" > "$TMP/scp.log" 2>&1 || { cat "$TMP/scp.log"; exit 1; }
grep -q "listen 443 ssl" "$TMP/conf.d3/blog.example.com.conf" || { echo "644 acme.sh left the site on bootstrap"; cat "$TMP/scp.log"; exit 1; }

echo "== missing acme.sh must fail loudly, not report success"
mv "$OUT/server/acme.sh" "$OUT/server/acme.sh.hidden"
rm -rf "$TMP/conf.d4" "$TMP/certs4" && mkdir -p "$TMP/conf.d4" "$TMP/certs4"
if CONF_DIR="$TMP/conf.d4" NGINX_CONF_DIR="$TMP/conf.d4" CERT_DIR="$TMP/certs4" bash "$OUT/server/install.sh" > "$TMP/noacme.log" 2>&1; then
  echo "install.sh should fail when acme.sh is missing"; exit 1
fi
grep -q "acme.sh not found" "$TMP/noacme.log"
mv "$OUT/server/acme.sh.hidden" "$OUT/server/acme.sh"

echo "== rollback must restore the user original config, not the bootstrap"
chmod +x "$OUT/server/acme.sh"
rm -rf "$TMP/conf.d5" "$TMP/certs5" && mkdir -p "$TMP/conf.d5" "$TMP/certs5"
echo "# ORIGINAL-USER-CONFIG" > "$TMP/conf.d5/blog.example.com.conf"
if CONF_DIR="$TMP/conf.d5" NGINX_CONF_DIR="$TMP/conf.d5" CERT_DIR="$TMP/certs5" FAKE_NGINX_FAIL=1 bash "$OUT/server/install.sh" > "$TMP/rollback2.log" 2>&1; then
  echo "install.sh should have failed"; exit 1
fi
grep -q "ORIGINAL-USER-CONFIG" "$TMP/conf.d5/blog.example.com.conf" || { echo "rollback lost the original config"; cat "$TMP/rollback2.log"; exit 1; }

echo "== placeholder token must abort the client install"
sed -i.bak 's/auth.token = ".*"/auth.token = "CHANGE_ME_TOKEN"/' "$OUT/client/frpc.toml"
if FRPC_BIN=/bin/true bash "$OUT/client/install.sh" > "$TMP/client.log" 2>&1; then
  echo "client install should refuse CHANGE_ME_TOKEN"; exit 1
fi
grep -q "still contains CHANGE_ME_TOKEN" "$TMP/client.log"

echo "== all e2e checks passed"