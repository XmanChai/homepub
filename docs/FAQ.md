# FAQ

**为什么不直接用 frp 的 `type = "http"`？**
可以，但证书就变成每台 frpc 各自管一份，TLS 策略、HTTP/2、访问日志也分散了。用 TCP 隧道 + nginx 终止 TLS：证书只有一处、443 只在一处监听、frps 只搬加密字节。

**第一次安装会不会把 nginx 弄挂？**
不会按"先装 443 再签证书"的顺序来。`install.sh` 先装只有 80 端口的引导站点（ACME 校验 + 503），`nginx -t` 通过并 reload 后才去签证书；证书签好再换成 443 站点。任何一次 `nginx -t` 失败都会用备份回滚，并重新 reload 回可用状态。

**签名证书失败会怎样？**
站点停在 HTTP 引导页（返回 503），你的其他站点不受影响。修好 `acme.sh` 后重新跑一次 `install.sh` 即可；已存在证书的域名会直接用 443 站点。

**为什么不自动执行 nginx reload？**
生成阶段不碰生产；安装脚本里才做"备份 → 安装 → `nginx -t` → reload"，且失败回滚。

**为什么隧道端口从 18081 开始？**
避开常见端口。用 `tunnel.portStart/portEnd` 改成任意段。分配结果写进 `ports.json`，加服务只分配新端口，不改旧的。

**删掉一个服务后旧域名还开着吗？**
`apply --prune` 会删掉 `out/` 里不再需要的文件；公网服务器再跑一次 `install.sh`，它会按 `.homepub-managed` 清单删掉对应 vhost（有备份、失败回滚）。两步都做了旧域名才真正下线。

**证书怎么续？**
本工具只负责 `acme.sh --issue` + `--install-cert`，续期靠 acme.sh 自带 cron/timer。`homepub doctor` 会显示证书剩余天数，并做完整 TLS 校验（过期/自签会判失败）。

**`doctor` 报 DNS 失败？**
它要求域名解析到 `server.addr`（会解析 A/AAAA 后比对）。如果用了 CDN/代理（Cloudflare 小黄云），解析到的是 CDN 地址，这时 DNS 项会失败——属预期，可忽略该行，或把 `server.addr` 写成 CDN 回源记录。

**frpc 不在 `/usr/local/bin/frpc`？**
`client/install.sh` 会用 `command -v frpc` 探测，并把 systemd unit 的 `ExecStart` 改成实际路径；也可以 `FRPC_BIN=/path/to/frpc` 指定。用 Docker 跑 frpc 的话用 `docker-compose.yml` 的 `frpc` profile。

**nginx 1.25+ 的 http2 警告？**
v0.1 使用 `listen 443 ssl;`（默认不开 http2），不会触发 deprecated 警告。需要 HTTP/2 时自行加 `http2 on;`（要求 nginx ≥ 1.25.1）。

**支持 frp 哪个版本？**
v0.52 及以上的 TOML 配置（`[[proxies]]`、`auth.token`、`transport.tls.enable`）。老版 INI 格式不支持。

**能不能不用 acme.sh？**
可以：自己放好证书到 `paths.nginxCertsDir`（`<host>.pem` / `<host>.key`），再跑 `install.sh`，它会直接装 443 站点。
