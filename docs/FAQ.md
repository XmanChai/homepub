# FAQ

**为什么不直接用 frp 的 `type = "http"`？**
可以，但证书就变成每台 frpc 各自管一份，TLS 策略、HTTP/2、访问日志也分散了。用 TCP 隧道 + nginx 终止 TLS，证书只有一处、443 只在一处监听，frps 只搬加密字节。代价是多一次 nginx 转发，家庭规模无所谓。

**为什么隧道端口从 18081 开始？**
避开常见端口（80/443/8080/8443/9000…），并且和你现有习惯一致。用 `tunnel.portStart/portEnd` 改成任意段。

**端口会漂移吗？**
不会。分配结果写进 `ports.json`，加服务只分配新端口，不改旧的。所以**别删 `ports.json`**，最好提交进 git。

**证书怎么续？**
本工具只负责 `acme.sh --issue` + `--install-cert`，续期靠 acme.sh 自带的 cron/timer（安装时默认注册）。`homepub doctor` 会显示证书剩余天数。

**为什么不自动执行 `nginx -t && reload`？**
生成阶段不该碰生产。安装脚本会做：备份 → 安装 → `nginx -t` → reload，失败会停在 `nginx -t` 之前。

**能管 UDP 吗？**
v0.1 只做 TCP（HTTP/HTTPS/WebSocket）。UDP 在 v0.2。

**支持 Cloudflare 代理（小黄云）吗？**
可以，但 Cloudflare 只代理 80/443，且会终结 TLS：此时源站的证书仍需要（Full/Full-strict），并且真实 IP 在 `CF-Connecting-IP`。生成配置没有为此特判，按需在 nginx 里加 `set_real_ip_from`。

**多个根域名怎么办？**
一个 `homepub.config.json` 一个根域名。多域名就建多份配置（例如 `homepub.blog.json`），台账分开。

**会不会改我的 nginx 主配置？**
不会。只往 `conf.d` 放 server 块和一个 `00-homepub-map.conf`（WebSocket 用的 `map`，必须在 http 上下文，conf.d 正好是）。

**为什么还要写 frps 片段，不能全自动？**
frps 属于"公网入口"，改错会全站不可用。工具给片段，你贴一次即可；`proxyBindAddr` 这一行是安全关键，值得人工确认。
**frpc 不在 `/usr/local/bin/frpc` 怎么办？**
生成的 `client/frpc.service` 是按这个路径写的。改 `ExecStart` 或建个软链：`sudo ln -s "$(which frpc)" /usr/local/bin/frpc`。如果你用 Docker 跑 frpc，用 `docker-compose.yml` 里的 `frpc` profile，不用 systemd。

**nginx 1.25+ 对 `listen 443 ssl http2` 报 deprecated 警告？**
只是警告，配置仍然有效。想消掉可改成 `listen 443 ssl;` + 单独一行 `http2 on;`（要求 nginx ≥ 1.25.1）。

**支持 frp 哪个版本？**
v0.52 及以上的 TOML 配置格式（`[[proxies]]`、`auth.token`、`transport.tls.enable`）。老版 INI 格式（`[common]`）不支持。
