# 发布前检查清单

本仓库含占位符，发布到 GitHub / npm 前逐项替换。

## 1. 替换占位符

```bash
# 仓库地址（package.json 的 repository/homepage/bugs 目前省略，发布后补）
grep -rn "yourname" . --exclude-dir=.git --exclude-dir=node_modules || true
```

- [ ] `docs/SUPPORT.md`：填入真实爱发电链接
- [ ] `README.md` / `README.en.md`：支持段落填链接
- [ ] `package.json`：补 `repository`、`homepage`、`bugs`（替换成真实 owner 后再加）
- [ ] `docs/config.schema.json`：如发布 schema 到 raw.githubusercontent，在 `examples/homepub.config.json` 里加 `$schema`

## 2. 必须真机验证（本机无法替代）

- [ ] 在一台干净 Ubuntu（有 nginx + acme.sh）上，从零执行 README 第 5–6 步
- [ ] 确认首次安装后 `curl -I https://<host>` 正常，证书有效期正确
- [ ] 删一个服务 → `apply --prune` → 服务器 `install.sh` → 旧域名 404/下线
- [ ] 故意写坏一个 conf，确认 `install.sh` 回滚且 nginx 仍可 reload
- [ ] `homepub doctor` 对过期证书/自签证书确实报失败
- [ ] Docker：`docker build -t homepub .` 与 `docker compose run --rm homepub plan`

## 3. 发布

- [ ] `npm test`、`bash scripts/e2e-install.sh` 全绿
- [ ] `npm pack --dry-run` 确认包含 `examples/`、`CHANGELOG.md`
- [ ] `git tag v0.1.0 && git push --tags`
- [ ] 先 GitHub Release，再考虑 npm publish（名字 homepub 当前未被占用，发布前再确认）
- [ ] README 顶部加 demo GIF（30 秒：init → plan → doctor）
