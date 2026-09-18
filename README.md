# turnsolesama 的个人作品集

个人网站：https://turnsolesama.github.io/

当前采用方案 C：编辑式布局、固定侧栏与软件作品目录。内容覆盖公开软件、项目详情、版本下载和更新进展，后续再加入视频等创作。

## 内容维护

- `content/projects.json`：项目介绍、软件图标、平台说明与下载入口。
- `public/`：页面源文件，含本地风格预览与模板参考。
- `scripts/sync.mjs`：读取独立项目的公开发行记录及明确程序包链接，刷新版本与下载，不修改软件仓库。
- `scripts/build.mjs`：生成静态页面。`--production` 只生成 C，不发布风格对比、模板页或其他方案。
- `docs/`：首次发布的静态快照，仅包含正式 C 网站。

Node.js 22+：

```sh
node scripts/sync.mjs
node scripts/build.mjs --production
```

生产输出为 `dist-production/`。软件功能说明需要按实际发布内容维护；同步脚本不会推测或编造功能。

本地查看全部设计预览：

```sh
node scripts/build.mjs
node scripts/serve.mjs
```

软件安装包仍存放在对应 GitHub 仓库或历史公开下载地址，本仓库不重复上传安装包。角色素材与服装设计版权归原权利人，详情中保留相应说明。
