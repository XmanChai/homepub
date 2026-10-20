# 仓库托管：GitHub 主仓 + Gitea 镜像

## 建议的分工

| 角色 | 位置 | 用途 |
| --- | --- | --- |
| **主仓库（canonical）** | GitHub `<owner>/homepub` | 收 issue / PR、跑 GitHub Actions、发 Release、npm 溯源 |
| 国内镜像 | <https://git.xmanchai.top/xmanchai/homepub> | 只读镜像：国内 clone 快、跨平台备份、GitHub 不可达时的退路 |

原则：**issue 和 PR 只收一处**（GitHub）。镜像仓库只镜像 git 数据，issues、releases、wiki 都不同步；两边都收 issue 会分裂。

## 方式 A：Gitea 拉取镜像（推荐，零维护）

Gitea 1.27 支持 "Pull Mirror"：Gitea 主动定时从 GitHub 拉。

1. GitHub 上建好 `homepub` 仓库并 push 一次；
2. Gitea → 右上角 `+` → **迁移外部仓库 / New Migration** → 选 GitHub → 填 `https://github.com/<owner>/homepub`；
3. 勾选 **This repository will be a mirror**（镜像仓库），间隔选 8 小时；
4. 之后不用再管，GitHub 有更新时 Gitea 自动拉。

注意：镜像仓库在 Gitea 里是只读的（不能直接在 Gitea 网页上改），正符合"只读镜像"的定位。

## 方式 B：本地双推（想立刻有内容时用）

```bash
# GitHub 建空仓库后
git remote add origin https://github.com/<owner>/homepub.git
git remote add gitea  https://git.xmanchai.top/xmanchai/homepub.git

git push -u origin main
git push gitea main

# 发版时两个都推 tag
git tag -a v0.1.0 -m "homepub v0.1.0"
git push origin v0.1.0 && git push gitea v0.1.0
```

Gitea 需要先在网页上建同名空仓库（或允许 push-to-create，取决于实例配置）。

## CI 放在哪

- **GitHub Actions 是主 CI**（`.github/workflows/ci.yml` 已就绪）。
- Gitea Actions 也支持，但需要实例装 `act_runner` 并注册 runner。你的 Gitea 是 1.27.3，能力具备，但不要默认它已配置好；要启用时，把 workflow 复制到 `.gitea/workflows/ci.yml` 并确认 runner 在线。
- 不要两边都跑（重复消耗、结果不一致更难查）。

## 发布时的双轨动作

```bash
# 1) GitHub Release（附件、changelog）
gh release create v0.1.0 --notes-file CHANGELOG.md

# 2) Gitea 侧的 Release 不会自动同步；需要时用 API 或网页补一条
#    只发 git tag 的话，Gitea 镜像里能看到 tag，但看不到 release notes
```

## 安全与备份

- 仓库里不允许出现 `frp token`、SSH 私钥、`.env`；`.gitignore` 已忽略 `out/` 和 `*.bak.*`。
- Gitea 数据在 `/srv/data/gitea`，已有 `gitea dump` 备份；GitHub 侧本身也是一份异地冗余。
- 公开仓库意味着任何人都能提 PR：在 GitHub 设置里开启 "Require approval for first-time contributors"，防止垃圾 PR 触发 CI 消耗。
