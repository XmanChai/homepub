# 爱发电发布文案（草稿）

把下面内容贴到 <https://afdian.com/a/xmanchai> 的"发布动态/项目"里，配 1 张图（终端里 `homepub plan` 的输出截图就可以）。

---

## 标题

**做了一个把家里服务器发布到公网的小工具：homepub（开源，求试用）**

## 正文

家里有几台服务器、想把自己写的服务挂到公网上，每次都要改三个地方：frpc 配置、frps 端口、nginx 站点加证书。改漏一处就排查半天，端口还会不知不觉撞上。

所以写了个工具 **homepub**：只维护一份 JSON，一条命令生成 frpc/nginx/acme 的配置，顺手维护端口台账，再用 `homepub doctor` 体检一遍（本地端口、DNS、证书剩余天数）。

几个我比较在意的点：

- **失败不会把 nginx 弄挂**：先装只有 80 端口的引导站点，签完证书再切 443；任何一次 `nginx -t` 失败都会自动回滚。
- **端口不漂移**：分配记录在 `ports.json`，加服务只分配新端口；删服务后 `apply --prune` 清旧配置。
- **证书真的会验**：`doctor` 做完整 TLS 校验，过期/自签会直接报失败，不糊弄。
- **零运行时依赖**：Node 22 内置能力 + 纯字符串生成，不装任何 npm 包。

现在的状态：v0.1.0-rc，33 个单测 + 6 个安装场景的端到端测试都过了，但**还没在干净的公网机器上从零跑过**——所以先发出来找几个愿意一起踩坑的人。

适合谁：用 frp/自建服务、想省掉配置工作的人；以及想给家里 NAS 挂几个域名的人。

仓库：

- GitHub：<https://github.com/xmanchai/homepub>
- 国内镜像：<https://git.xmanchai.top/xmanchai/homepub>

如果你试用时踩到坑，直接在 GitHub 提 issue，或者这里留言都行。觉得有用的话，打赏就当给我的服务器续费了 :P

## 标签

开源 / 自托管 / NAS / frp / nginx / Node.js

---

> 发布后记得把正文里的 GitHub 地址换成真实地址（如果 owner 不是 xmanchai）。
> 建议配图：`node bin/homepub.js plan` 的终端截图 + 一张架构图（README 里那段 ASCII 可以截图）。
