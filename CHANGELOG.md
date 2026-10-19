# Changelog

## 0.1.0 (2026-10-20)

首个可用版本。

- `init` / `plan` / `apply` / `status` / `doctor`，零运行时依赖
- 生成 frpc.toml、systemd unit、nginx 站点、ACME 脚本、frps 片段与整份示例
- **两阶段安装**：HTTP 引导（ACME + 503）→ 签证书 → HTTPS 站点，`nginx -t` 失败自动回滚
- 端口台账 `ports.json`（分配稳定、可提交、`out/` 删除也不漂移）
- 删除服务后可 `apply --prune` 清理旧产物；服务器端按 `.homepub-managed` 清单清理旧 vhost
- `doctor` 做完整 TLS 校验（过期/自签会失败）、DNS 解析比对、证书剩余天数
- 安装脚本：占位 token 直接中止、systemd unit 备份、`command -v frpc` 探测路径
- 配置校验：未知字段 warning、路径字符白名单（防注入）
- 33 个单测 + `scripts/e2e-install.sh`（fake nginx/acme.sh 验证安装、回滚、token 中止）
