# homepub

一条命令把家里的服务发布到公网：`frp + nginx + ACME` 的配置生成、端口台账和体检。

[English](README.en.md) | 中文

```
浏览器 --HTTPS(443)--> 公网 ECS 上的 nginx --HTTP--> 127.0.0.1:18081
                                                      |
                                              frps <--+-- frpc（家里那台机器）
                                                      |
                                              127.0.0.1:8090 你的服务
```

## 它解决什么问题

给家庭服务器 / 小公司自建服务开公网，通常要在三处同时改配置：

1. 家里那台：`frpc.toml`（服务名、本地端口、隧道端口）
2. 公网那台：`frps.toml`（token、允许的端口段）
3. 公网那台：nginx 站点 + 证书续期（`server_name`、`proxy_pass`、`ssl_certificate`）

改三处必然漏一处，于是出现这些真实问题：

- 18081–18092 的端口到底谁在用？没人说得清，加服务时开始撞端口。
- 证书续期只配了一次，某天浏览器开始报错才发现。
- 服务挂了不知道，等有人反馈"打不开"。
- 换机器时配置靠记忆重建。

homepub 把"服务清单"变成唯一事实来源：你只写一份 JSON，它生成上面三处的配置、维护端口台账（`ports.json`）、并提供一条命令做体检。

## 它不做什么（先说明白）

- 不帮你买服务器、域名或做备案。
- 不托管你的服务，也不碰运行中的数据。
- 不替代 frps 部署，只生成需要追加的片段。
- 不是 7×24 监控，`doctor` 是"我现在跑一下"的体检，不是告警平台。
- 默认**不自动改生产配置**：它生成文件 + 带备份的安装脚本，最后一步由你执行。

## 快速开始

要求：Node.js ≥ 22（生成端），一台装好 `frps` 的公网服务器，家里那台装好 `frpc`。

```bash
# 1) 生成一份配置模板
npx homepub init
#    （仓库内开发：node bin/homepub.js init）

# 2) 编辑 homepub.config.json：域名、公网 IP、每个服务的本地端口

# 3) 看它准备生成什么、端口怎么分配（不写文件、不联网）
npx homepub plan

# 4) 真写文件（token 从环境变量取，写进 frpc.toml 时权限 600）
export FRP_TOKEN='和 frps 一致的 token'
npx homepub apply

# 5) 家里那台执行：
sudo bash out/client/install.sh

#    公网那台执行（先追加 out/server/frps-snippet.toml 到 frps.toml 并重启 frps）：
sudo bash out/server/install.sh
sudo bash out/server/acme.sh        # 首次签发证书；acme.sh 会自动续期

# 6) 体检：本地端口、DNS、公网 HTTPS、证书剩余天数
npx homepub doctor
```

`doctor` 输出示例：

```
service       local port                dns                       https
------------------------------------------------------------------------------------------
blog          ok (2ms)                  ok                        200 (62d cert)
cloud         ok (3ms)                  ok                        302 (62d cert)
music         FAIL ECONNREFUSED         ok                        FAIL ECONNREFUSED
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `homepub init [dir]` | 生成 `homepub.config.json` 模板 |
| `homepub plan` | 显示将生成/修改哪些文件、端口如何分配（只读） |
| `homepub apply` | 写入 `out/`，只更新内容有变化的文件；同时更新 `ports.json` |
| `homepub status` | 打印端口台账（谁在用哪个隧道端口） |
| `homepub doctor` | 检查本地端口 / DNS / 公网 HTTPS / 证书天数 |
| `homepub help` | 帮助 |

常用参数：`--config <path>`、`--out <dir>`、`--token <token>`、`--force`、`--json`。

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
| `server.addr` | 是 | 公网服务器地址（frps 所在） |
| `server.port` | 否 | frps 端口，默认 7000 |
| `server.tokenEnv` | 否 | 从哪个环境变量读 token，默认 `FRP_TOKEN` |
| `server.bindAddr` | 否 | 写进 frps 片段，默认 `127.0.0.1`（只绑回环，避免隧道端口暴露公网） |
| `tunnel.portStart/portEnd` | 否 | 隧道端口段，默认 18081–18099；端口分配记录在台账里，不会随服务增减而漂移 |
| `paths.out` | 否 | 生成目录，默认 `./out`（相对配置文件所在目录） |
| `paths.ledger` | 否 | 端口台账位置，默认 `./ports.json`（相对配置文件；**建议提交进 git**） |
| `services[].name` | 是 | 小写字母/数字/短横线，最长 32 |
| `services[].subdomain` | 否 | 子域名，默认同 `name`；填 `""` 表示用根域名 |
| `services[].localPort` | 是 | 家里服务的本地端口 |
| `services[].localHost` | 否 | 默认 `127.0.0.1` |
| `services[].healthPath` | 否 | `doctor` 探测路径，默认 `/` |
| `services[].protocol` | 否 | 上游协议 `http` / `https`，默认 `http` |

## 安全说明

- **token 只进 `frpc.toml`（权限 600）**，不要提交到 git；仓库已忽略 `out/`。
- **隧道端口只绑回环**：`out/server/frps-snippet.toml` 里的 `proxyBindAddr = "127.0.0.1"` 让 18081–18099 只能被本机 nginx 访问，不会直接暴露到公网。**这一步很重要，别跳过。**
- 防火墙/安全组只放：`443`、`80`（ACME）、`7000/tcp`（frps）。
- 生成的 nginx 配置包含 HTTP→HTTPS 跳转与 WebSocket 支持（`00-homepub-map.conf`）。
- 建议再加 HSTS（确认全站 HTTPS 后）：`add_header Strict-Transport-Security "max-age=31536000" always;`

## 与宝塔 / Nginx Proxy Manager / 1Panel 的区别

那些是"带界面的 Web 服务器管理面板"，适合托管整台机器的站点；homepub 只做一件事：**把"家里服务 → 公网域名"这条链路生成正确、并且可校验**。它不抢 80/443 的默认站点，不接管 nginx 主配置，只往 `conf.d` 放 server 块。

## 路线图

- v0.1（当前）：TCP 隧道 + nginx 站点 + ACME + 端口台账 + doctor
- v0.2：`doctor --watch` 周期体检；UDP / HTTPS 隧道类型；Cloudflare 代理场景说明
- v0.3：可选 Web 界面（只读台账 + 一键生成）
- 不计划：自动改生产配置（默认永远关）、内置监控告警平台

## 支持这个项目

如果 homepub 帮你省下了配 frp + 证书的半天，可以请我喝杯咖啡：

- 爱发电：<https://afdian.com/a/yourname>（占位，发布前替换成你的主页）
- 企业赞助位（README logo + 每月 2 小时咨询）：在 issue 里说明需求

打赏是自愿的，不承诺 SLA、不构成购买。

## 许可

MIT