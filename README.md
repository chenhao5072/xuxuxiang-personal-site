# 许旭祥个人网站

一个带影像、故事和留言板的个人站点。页面使用 HTML、CSS 和原生 JavaScript；留言板使用 Cloudflare Workers 与 D1。原站：[xuxuxiang.fun](https://xuxuxiang.fun/)。

## 先跑起来

需要 Git 和 Node.js 22.13 或更高版本（推荐 Node.js 24）。

```sh
git clone https://github.com/chenhao5072/xuxuxiang-personal-site.git
cd xuxuxiang-personal-site
npm ci
npm run preview:example
```

打开 [http://127.0.0.1:4192](http://127.0.0.1:4192)。示例命令会构建网站、创建本地留言库并启动 Worker，不用登录 Cloudflare，也不会读取或写入原站留言。结束预览用 Ctrl+C。运行 `npm run verify` 可检查代码、执行测试并重新构建静态文件。

## 改成自己的网站

- 在 `index.html`、`404.html` 中改姓名、文案、联系信息及分享元数据；在 `styles.css` 和 `winter.css` 中改视觉样式。
- 用你自己有权公开的图片、二维码和动图替换 `assets/` 引用的对应文件。新增文件时，同步更新页面引用、`.gitignore` 和 `tools/build.mjs` 的素材允许规则。更换分享图时更新 `social-preview.jpg`。
- 把 `robots.txt`、`sitemap.xml` 和页面上的正式网址改成自己的域名。使用 GitHub Fork 后独立开发即可，不需要取得原仓库的写入或发布权限。

## 部署到自己的 Cloudflare

1. 把 `wrangler.example.jsonc` 复制为 `wrangler.custom.jsonc`，为 Worker 填一个自己的名称。不要用仓库自带的原站生产配置 `wrangler.jsonc`。
2. 用自己的 Cloudflare 账号执行下方登录和建库命令。如果 Wrangler 提示更新配置，只允许更新 `wrangler.custom.jsonc`。确认配置中的 D1 名称和 ID 都指向你新建的库，绑定名保持 `GUESTBOOK_DB`；替换示例 ID 后才能部署。
3. 完成构建、迁移和发布，再为新 Worker 设置用来签名留言提交的 `GUESTBOOK_SECRET`（使用自己生成的高强度随机值）。需要自定义域名时，在自己的 Worker 后台接入。

```sh
npx wrangler login
npx wrangler d1 create your-site-guestbook --config wrangler.custom.jsonc
```

确认填好自己的数据库配置后：

```sh
npm run build
npx wrangler d1 migrations apply GUESTBOOK_DB --remote --config wrangler.custom.jsonc
npx wrangler deploy --config wrangler.custom.jsonc
npx wrangler secret put GUESTBOOK_SECRET --config wrangler.custom.jsonc
```

`wrangler.custom.jsonc`、本地密钥文件及构建目录已被 Git 忽略。不要提交个人密钥、真实留言数据库或备份。原站独立部署，维护规则见 [AGENTS.md](AGENTS.md)。

## 许可范围

程序代码及其开发文档采用 [MIT License](LICENSE)。仓库里的真实人物照片、头像、动图、微信二维码、个人资料和其他非代码内容不在 MIT 授权范围内。它们可在此仓库查看；制作或发布自己的站点时，请使用自己有权使用的内容。
