# 发布前检查清单

仓库已无 yourname 类占位符；爱发电链接已填：<https://afdian.com/a/xmanchai>。
剩下的是"建仓 + 真机验证 + 发布"三件事。

## 1. 建仓与托管

- [ ] GitHub 建 `<owner>/homepub`（public，不要勾选 README/gitignore，保持空仓库）
- [ ] 把 `package.json` 的 `homepage` / `repository` / `bugs` 从 Gitea 改成 GitHub（建仓后必做，否则 npm 页面指向镜像）
- [ ] Gitea 建同名仓库或配 Pull Mirror，见 [docs/HOSTING.md](docs/HOSTING.md)
- [ ] README 顶部"主仓库（规划中）"改成真实 GitHub 链接
- [ ] GitHub 仓库设置：开启 "Require approval for first-time contributors"，避免垃圾 PR 消耗 CI

## 2. 必须真机验证（本机无法替代）

- [ ] 在一台干净 Ubuntu（有 nginx + acme.sh）上，从零执行 README 第 5–6 步
- [ ] 首次安装后 `curl -I https://<host>` 正常、证书有效期正确
- [ ] 删一个服务 → `apply --prune` → 服务器 `install.sh` → 旧域名下线
- [ ] 故意写坏一个 conf，确认 `install.sh` 回滚且 nginx 仍可 reload
- [ ] `homepub doctor` 对过期/自签证书确实报失败
- [ ] `docker build -t homepub .` 与 `docker compose run --rm homepub plan`

## 3. 发布

- [ ] `npm test`（33 个）、`bash scripts/e2e-install.sh <out>`（6 个场景）全绿
- [ ] `npm pack --dry-run` 包含 `examples/`、`CHANGELOG.md`
- [ ] `git tag -a v0.1.0 -m "homepub v0.1.0"`，GitHub 与 Gitea 都推 tag
- [ ] GitHub Release（changelog + 可选的 out 样例压缩包）
- [ ] 再考虑 npm publish（`homepub` 当前未被占用，发布前再确认一次）
- [ ] README 顶部加 30 秒 demo GIF（init → plan → doctor）
- [ ] 爱发电主页加一条项目介绍，指回仓库
