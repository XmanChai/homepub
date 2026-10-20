# homepub

一条命令把家里的服务发布到公网：生成 `frp + nginx + ACME` 的配置、端口台账，并做体检。

[English](README.en.md) | 中文

```
浏览器 --HTTPS(443)--> 公网 ECS 上的 nginx --HTTP--> 127.0.0.1:18081
                                                      |
                                              frps <--+-- frpc（家里那台机器）
                                                      |
                                              127.0.0.1:8090 你的服务
```

## 仓库在哪

- 主仓库（规划中）：GitHub —— 收 issue / PR、跑 CI、发 Release
- 国内镜像：<https://git.xmanchai.top/xmanchai/homepub> —— 只读镜像，方便国内 clone 和备份
- 镜像说明见 [docs/HOSTING.md](docs/HOSTING.md)

## 它解决什么问题

给家庭服务器 / 小公司自建服务开公网，通常要在三处同时改配置：家里的 `frpc.toml`、公网的 `frps.toml`、以及 nginx 站点 + 证书。改三处必然漏一处，于是：

- 18081–18099 的端口谁在用没人说得清，加服务开始撞端口；
- 证书续期只配过一次，某天浏览器报错才发现；
- 服务挂了没人知道；
- 换机器时配置靠记忆重建。

homepub 让你只写一份 JSON，生成上述配置、维护端口台账（`ports.json`），并提供一条命令做体检。

## 它不做什么（先说明白）

- 不帮你买服务器、域名或做备案；
- 不托管你的服务，也不碰运行中的数据；
- 不替代 frps 部署，只生成需要追加/替换的片段；
- 不是 7×24 监控，`doctor` 是"我现在跑一下"的体检；
- **生成阶段绝不改生产配置**：它写文件 + 带备份与回滚的安装脚本，最后一步由你执行。

## 快速开始

要求：Node.js ≥ 22；一台装了 `frps` 的公网服务器；家里那台装了 `frpc`；公网服务器有 `acme.sh`。

```bash
git clone <repo> && cd homepub     # 或 npm 发布后：npx homepub init

node bin/homepub.js init            # 生成 homepub.config.json
# 编辑：domain、server.addr、每个服务的 localPort

node bin/homepub.js plan            # 看要生成什么、端口怎么分（只读、不联网）
export FRP_TOKEN='与 frps 一致的 token'
node bin/homepub.js apply           # 写 out/ 与 ports.json

# 家里那台（会把 frpc.toml 与 systemd unit 备份后安装；发现占位 token 会直接中止）
sudo bash out/client/install.sh

# 公网那台：一条命令完成"HTTP 引导 → 签证书 → 切到 HTTPS"，失败自动回滚
sudo bash out/server/install.sh

# 体检：本地端口、DNS、公网 HTTPS、证书剩余天数（会做完整 TLS 校验）
node bin/homepub.js doctor
```

`doctor` 输出示例：

```
service       local port                dns                       https
------------------------------------------------------------------------------------------
blog          ok (2ms)                  ok                        200 (62d cert)
cloud         ok (3ms)                  ok                        302 (62d cert)
music         FAIL ECONNREFUSED         ok                        FAIL ECONNREFUSED
```

> 第一次安装时，`install.sh` 会先装"只有 80 端口 + ACME 校验"的引导站点（其余请求返回 503），
> 再调用同目录的 `acme.sh` 签发证书，最后换成 443 站点。任何一步 `nginx -t` 失败都会回滚到安装前的配置。

## 命令

| 命令 | 作用 |
| --- | --- |
| `init [dir]` | 生成 `homepub.config.json` 模板 |
| `plan` | 显示将创建/修改/删除哪些文件、端口如何分配（只读） |
| `apply` | 写入 `out/`（只写内容有变化的文件）并更新 `ports.json` |
| `status` | 打印端口台账 |
| `doctor` | 检查本地端口 / DNS / 公网 HTTPS / 证书有效期 |
| `help` | 帮助 |

参数：`--config <path>`、`--out <dir>`、`--token <token>`、`--ledger <path>`、`--force`、`--prune`、`--json`。

- `--prune`：删除"以前生成、现在不再属于配置"的文件（删服务后清理它的 nginx 站点）。
- `--json`：`plan` / `status` / `doctor` 输出机器可读结果。

## 配置说明

```json
{
  "domain": "example.com",
  "server": { "addr": "203.0.113.10", "port": 7000, "tokenEnv": "FRP_TOKEN", "bindAddr": "127.0.0.1" },
  "tunnel": { "portStart": 18081, "portEnd": 18099 },
  "paths": {
    "out": "./out",
    "ledger": "./ports.json",
    "frpcConfig": "/etc/frp/frpc.toml",
    "nginxConfDir": "/etc/nginx/conf.d",
    "nginxCertsDir": "/etc/nginx/certs",
    "acmeHome": "/root/.acme.sh",
    "acmeWebroot": "/var/www/acme"
  },
  "services": [
    { "name": "blog", "subdomain": "blog", "localPort": 8090, "healthPath": "/" },
    { "name": "cloud", "subdomain": "nc", "localPort": 8080, "healthPath": "/status.php" }
  ]
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `domain` | 是 | 根域名，公网解析到 `server.addr` |
| `server.addr` | 是 | 公网服务器地址（frps 所在），IP 或域名 |
| `server.port` | 否 | frps 端口，默认 7000 |
| `server.tokenEnv` | 否 | 从哪个环境变量读 token，默认 `FRP_TOKEN` |
| `server.bindAddr` | 否 | 写进 frps 片段，默认 `127.0.0.1`（只绑回环） |
| `tunnel.portStart/portEnd` | 否 | 隧道端口段，默认 18081–18099 |
| `paths.out` | 否 | 生成目录，默认 `./out`（相对配置文件） |
| `paths.ledger` | 否 | 端口台账，默认 `./ports.json`（相对配置文件，**建议提交进 git**） |
| `paths.*` | 否 | 只允许字母、数字、点、短横线、下划线和斜杠（防止注入） |
| `services[].name` | 是 | 小写字母/数字/短横线，最长 32 |
| `services[].subdomain` | 否 | 子域名，默认同 `name`；填 `""` 用根域名 |
| `services[].localPort` | 是 | 家里服务的本地端口 |
| `services[].localHost` | 否 | 默认 `127.0.0.1` |
| `services[].healthPath` | 否 | `doctor` 探测路径，默认 `/` |
| `services[].protocol` | 否 | 上游协议，默认 `http` |

未知字段会给出 warning（不再静默忽略）。

## 安全说明

- **token 只进 `frpc.toml`（600）**；`out/` 已在 `.gitignore` 里。
- **隧道端口只绑回环**：`server/frps-snippet.toml` 的 `proxyBindAddr = "127.0.0.1"` 让 18081–18099 只能被本机 nginx 访问。**这一行要放在 frps.toml 的第一个 `[table]` 之前**（放末尾会被 TOML 解析进表里而失效），或者直接用 `server/frps.toml.example` 替换整份配置。
- 防火墙/安全组只放：`443`、`80`（ACME）、`7000/tcp`（frps）。
- `server/install.sh` 会写 `conf.d/.homepub-managed` 清单，删掉的服务下次安装时自动清理旧站点。
- 建议全站 HTTPS 后再加 HSTS：`add_header Strict-Transport-Security "max-age=31536000" always;`

## 与宝塔 / Nginx Proxy Manager / 1Panel 的区别

那些是"带界面的 Web 服务器管理面板"，适合托管整台机器；homepub 只做一件事：把"家里服务 → 公网域名"这条链路生成正确、可校验、可回滚。它不接管 nginx 主配置，只往 `conf.d` 放 server 块和一个 WebSocket 用的 map。

## 路线图

- v0.1（当前）：TCP 隧道 + nginx 站点 + ACME 两阶段安装 + 端口台账 + doctor
- v0.2：`doctor --watch`；UDP / HTTPS 隧道；Cloudflare 代理说明
- v0.3：只读 Web 界面（台账 + 一键生成）
- 不计划：自动改生产配置（默认永远关）、内置告警平台

## 支持这个项目

如果 homepub 帮你省下了配 frp + 证书的半天：

- 爱发电：<https://afdian.com/a/xmanchai>
- 企业赞助位（README logo + 每月 2 小时咨询）：开 issue 说明需求

打赏自愿，不承诺 SLA、不构成购买。

## 许可

MIT