# Hanazar Transfer

一个无需公网服务器的局域网文件传输工具。局域网内的一台电脑运行本项目，其他手机、平板和电脑通过浏览器打开它的局域网地址，即可自动发现彼此并传送文件或文字。

当前版本：`v0.2.2` · [查看版本公告](ANNOUNCEMENT.md) · [历史公告](docs/announcements/README.md)

## 已实现

- 响应式发送与接收界面，适配手机、平板和电脑
- 自动发现当前局域网内打开页面的设备
- 选择设备后一键投递文件或文字，接收方实时收到通知
- 多文件选择、拖放上传和逐文件进度
- 支持取消上传，并自动清理未完成传输
- 可选的发送与接收提示音，默认关闭
- 8 位易读传输码与一键分享链接
- 流式上传和下载，不把完整文件读入服务端内存
- 独立上传令牌，传输码只授予读取权限
- 文件数量、总大小、请求体和 MIME 类型校验
- 24 小时自动过期清理，可通过环境变量调整
- CSP 等基础安全响应头和结构化 API 错误
- 零运行时依赖，仅需 Node.js 22+

## 本地运行

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
- 不要打开 GitHub Pages 地址；设备应直接打开局域网电脑显示的 IP 地址

## Docker

```bash
docker build -t hanazar-transfer .
docker run --rm -p 3000:3000 hanazar-transfer
```

## GitHub Pages 限制

GitHub Pages 只能发布静态页面，不能运行设备发现、事件流和文件中转接口。因此 `https://hzagaming.github.io/HanazarTransfer/` 可以作为项目介绍页，但不能替代局域网电脑上运行的 Node.js 服务。

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

传输码相当于下载凭证，请只分享给接收方。文件会经过运行本项目的局域网电脑，但不会上传到第三方服务。若将端口暴露到公网，必须启用 HTTPS、访问控制、IP 限流、磁盘配额和恶意文件检测。
