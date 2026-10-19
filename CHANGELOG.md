# Changelog

## 0.1.0 (2026-10-20)

- `init` / `plan` / `apply` / `status` / `doctor`
- 生成 frpc.toml、systemd unit、nginx server 块、ACME 签发脚本、frps 安全片段
- 端口台账 `ports.json`（分配稳定、可提交）
- 安装脚本带备份、`nginx -t` 与回滚提示
- 25 个单测（配置校验、端口稳定、渲染确定性、幂等写入、doctor 注入）
