# Hanazar Transfer

一个无需账号的跨设备文件传输工具。可以直接使用 GitHub Pages 在两个现代浏览器之间进行 WebRTC 加密直传，也可以在局域网电脑运行 Node.js 服务，自动发现设备并中转文件或文字。

当前版本：`v0.3.1` · [查看版本公告](ANNOUNCEMENT.md) · [历史公告](docs/announcements/README.md)

## 已实现

- 响应式发送与接收界面，适配手机、平板和电脑
- 自动发现当前局域网内打开页面的设备
- 选择设备后一键投递文件或文字，接收方实时收到通知
- 多文件选择、拖放上传和逐文件进度
- 支持取消上传，并自动清理未完成传输
- 可选的发送与接收提示音，默认关闭
- GitHub Pages 纯前端 P2P 直传，无需部署后端或注册账号
- 手动邀请与回复配对，不把连接信息写入服务器
- WebRTC DataChannel 双向传送文件和文字，支持进度、取消和下载记录
- 8 位易读传输码与一键分享链接
- 流式上传和下载，不把完整文件读入服务端内存
- 独立上传令牌，传输码只授予读取权限
- 文件数量、总大小、请求体和 MIME 类型校验
- 24 小时自动过期清理，可通过环境变量调整
- CSP 等基础安全响应头和结构化 API 错误
- 零运行时依赖，仅需 Node.js 22+

## GitHub Pages P2P 直传

打开 [Hanazar Transfer](https://hzagaming.github.io/HanazarTransfer/)，点击“打开 P2P 直传”，然后：

1. 一台设备选择“发起连接”，把邀请链接发给另一台设备。
2. 另一台设备打开链接并生成回复码，再把回复码发回。
3. 发起设备粘贴回复码并完成连接，双方都可以发送文件或文字。

该模式完全在浏览器前端运行，不请求 Hanazar Transfer API。文件通过 WebRTC DataChannel 的 DTLS 加密连接直达对方，不上传到 GitHub Pages，也不会保存在仓库。单批最多 20 个文件、总计 512 MB；接收页面需要保持打开，下载记录只在当前标签页内保留。

由于没有信令服务器、STUN 或 TURN，纯前端版本不能像 Snapdrop 一样自动发现设备，也不能保证跨网络或启用了客户端隔离的 Wi-Fi 可连接。同一局域网成功率最高；若直连失败，请改用下面的本地服务模式。

## 局域网服务模式

```bash
npm test
npm start
```

启动后终端会显示可访问地址，例如：

```text
Hanazar Transfer is ready:
  http://localhost:3000
  http://192.168.1.20:3000
```

本机打开 `http://localhost:3000`，其他设备打开显示的 `192.168.x.x` 地址。所有设备需要连接同一个 Wi-Fi 或局域网。

这台电脑承担局域网中转，因此传输期间需要保持程序运行。文件只写入系统临时目录，不会写入仓库；服务退出或重启时会清空当前传输。

### 无法发现设备时

- 允许 Node.js 通过 Windows/macOS 防火墙
- 关闭手机或电脑上的 VPN、代理后重试
- 确认路由器没有启用 AP Isolation、访客网络隔离或客户端隔离
- 若不方便运行服务，可在 GitHub Pages 首页改用 P2P 直传

## Docker

```bash
docker build -t hanazar-transfer .
docker run --rm -p 3000:3000 hanazar-transfer
```

## 可选公网部署

将 Node.js 服务或 Docker 镜像部署到有公网域名的主机，并在反向代理或托管平台启用 HTTPS。代理层的请求体上限和上传超时不能低于应用配置。

```bash
MAX_TRANSFER_BYTES=536870912 \
TRANSFER_TTL_MS=43200000 \
UPLOAD_TIMEOUT_MS=7200000 \
npm start
```

| 环境变量 | 默认值 | 用途 |
| --- | ---: | --- |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `3000` | HTTP 端口 |
| `DATA_DIR` | 系统临时目录 | 当前进程文件目录的父目录 |
| `MAX_TRANSFER_BYTES` | `2147483648` | 单次传输最大总字节数 |
| `MAX_FILES` | `20` | 单次传输最大文件数 |
| `TRANSFER_TTL_MS` | `86400000` | 文件有效期 |
| `UPLOAD_TIMEOUT_MS` | `7200000` | 单个 HTTP 请求超时 |

当前版本使用单进程内存保存传输元数据，并把文件放在进程专属临时目录。服务重启会清空传输，不适合直接水平扩容。生产规模化时应把文件层替换为 S3/R2 等对象存储，并使用共享数据库保存元数据和过期时间。

## API

- `POST /api/transfers`：创建传输
- `PUT /api/transfers/:code/files/:fileId`：流式上传文件
- `GET /api/transfers/:code`：查询文件列表
- `GET /api/transfers/:code/files/:fileId`：下载文件
- `DELETE /api/transfers/:code`：使用上传令牌提前删除
- `POST /api/peers`：注册局域网设备
- `GET /api/peers/:id/events`：订阅附近设备和消息事件
- `POST /api/peers/:id/messages`：投递文字或文件通知
- `GET /health`：健康检查

## 安全模型

P2P 模式的邀请链接和回复码包含临时连接信息，只应发送给目标设备；文件不经过 Hanazar Transfer 服务。局域网服务模式的传输码相当于下载凭证，文件会经过运行本项目的电脑，但不会上传到第三方服务。若将服务端口暴露到公网，必须启用 HTTPS、访问控制、IP 限流、磁盘配额和恶意文件检测。
