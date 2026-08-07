# Hanazar Transfer

一个无需登录的跨设备网页文件中转工具。发送方上传一个或多个文件后，会得到 8 位传输码和分享链接；接收方在任意设备的浏览器中打开链接或输入传输码即可下载。

## 已实现

- 响应式发送与接收界面，适配手机、平板和电脑
- 多文件选择、拖放上传和逐文件进度
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

打开 `http://localhost:3000`。

若要让同一局域网内的手机访问，保持 `HOST=0.0.0.0`，然后打开 `http://<电脑局域网 IP>:3000`。系统防火墙需要允许该端口。

## Docker

```bash
docker build -t hanazar-transfer .
docker run --rm -p 3000:3000 hanazar-transfer
```

## 公网部署

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
- `GET /health`：健康检查

## 安全模型

传输码相当于下载凭证，请只分享给接收方。文件会经过你的中转服务器，公网部署必须使用 HTTPS。若作为公共匿名服务运营，还应在网关增加 IP 限流、磁盘配额、恶意文件检测和滥用举报机制。
