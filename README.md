# 许旭祥个人网站

正式网站：[xuxuxiang.fun](https://xuxuxiang.fun/)。这个私有仓库保存当前生日版的完整源码和已审定的上线图片。GitHub 负责版本记录；网站、域名和留言仍在原 Cloudflare 项目，无自动上线流程。

## 一、换电脑：克隆并本地预览

安装 Git 和 Node.js（建议 Node.js 24 LTS，最低 22.13）。先用有仓库权限的 GitHub 账号登录 Git 凭据管理器，再在任意工作目录执行：

```sh
git clone https://github.com/chenhao5072/xuxuxiang-personal-site.git
cd xuxuxiang-personal-site
npm ci
npm run preview
```

打开 [本地预览 http://127.0.0.1:4192](http://127.0.0.1:4192)。预览会构建页面、初始化本地 D1 并启动 Worker；不需要 Cloudflare 登录，不会写入线上留言。验证或发布前，先按 Ctrl+C 停掉这个预览，避免 Windows 对构建目录加锁。

常用编辑位置：

- `index.html`：邀请函、页面文案和照片。修改邀约文案时，也同步检查 `birthday.js` 的复制文本、页面分享说明及 `social-preview.jpg`。
- `styles.css`、`birthday.css`：通用样式和生日主题；`app.js`、`birthday.js`、`guestbook.js`：页面交互。
- `assets/`：上线用的 8 张照片和裁切后的二维码。替换原文件前确认公开范围；新增素材需同时更新页面引用和 `.gitignore` 的允许列表。不要提交未裁切原片、原始二维码卡片或历史预览；`photo-10` 始终排除。
- `worker/index.js`、`migrations/`：留言板接口和数据库结构。仓库只包含迁移脚本，不包含留言数据。

构建时只将公开文件复制到 `public/`，为首页中的样式和脚本加上内容哈希。不要手改或提交生成目录。

## 二、发布到原 Cloudflare 网站

仅编辑或审阅源码，只需 GitHub 仓库权限。正式发布还需要自己的 Cloudflare 登录，以及目标账户的 Worker 发布权限；不要共享个人账号或密钥。首次在新电脑发布时，先运行：

```sh
npm run deploy:check
npm exec -- wrangler login
npm exec -- wrangler whoami
```

第一条命令执行检查、测试、构建及打包预检（`--dry-run`），不会上传；后两条让你在浏览器授权并确认账号。Wrangler 已由 `package-lock.json` 锁定，无需全局安装或依赖其他本地项目。

确认 `whoami` 的账户 ID 与 `wrangler.jsonc` 一致，且配置仍指向 Worker `xuxuxiang-personal`、自定义域名 `xuxuxiang.fun` 和 `www.xuxuxiang.fun`、现有 D1 `xuxuxiang-guestbook`（绑定 `GUESTBOOK_DB`）。确认提交和预览无误后：

```sh
npm run deploy
npm run verify:live
```

`npm run deploy` 会在检查、测试和构建全部通过后更新正式站。`npm run verify:live` 只读比对线上文件与构建包，检查主域名、www、HTTP 跳转和 404；报告在 `output/verification/online-readback.json`。最后打开正式站检查首页及留言显示。若需要回退，使用 Cloudflare 对应 Worker 的部署历史，不要回退或删除数据库。

## 三、保留留言和密钥

生产留言存放在原 Cloudflare D1；克隆、提交代码和普通发布都不会导入、清空或重新创建它。服务端签名密钥 `GUESTBOOK_SECRET` 已配置为 Worker Secret；换电脑不需要复制它，也不要用本地预览密钥覆盖。

留言的轮播、5 秒同步、限流和公开展示规则沿用。若以后需要备份真实留言，使用 [D1 导出](https://developers.cloudflare.com/d1/best-practices/import-export-data/)，把备份单独加密保管。不要提交 API Token、环境变量文件、Git 凭据、数据库备份或未公开素材。
