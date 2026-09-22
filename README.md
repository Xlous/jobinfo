---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '118863b7-1c54-4c4b-9cf9-1a63196e0731'
  PropagateID: '118863b7-1c54-4c4b-9cf9-1a63196e0731'
  ReservedCode1: 'abd8e98f-18b8-41a7-9f0e-6a80259941e3'
  ReservedCode2: 'abd8e98f-18b8-41a7-9f0e-6a80259941e3'
---

# 学院就业信息查询工具

一个轻量的网页工具：学生在搜索框输入企业名称，即可查到该企业相关的微信招聘推文链接。
支持飞书多维表格作为数据源、辅导员后台录入、统计看板、日期筛选、导出分享等功能。

---

## 一、文件说明

| 文件/目录 | 作用 |
| --- | --- |
| `index.html` | 网页本体，含搜索、筛选、统计、分页、导出、管理功能 |
| `config.js` | **前端配置**，设置 Worker API 地址和管理令牌 |
| `data.json` | 本地数据（回退用），未接入飞书时使用 |
| `worker/` | Cloudflare Worker 后端代码，代理飞书 API |
| `README.md` | 本说明文档 |

---

## 二、两种运行模式

### 模式一：飞书在线模式（推荐，功能完整）

数据存储在飞书多维表格中，辅导员可直接在页面上增删改，实时生效。

```
学生浏览器 → GitHub Pages (前端) → Cloudflare Worker → 飞书多维表格 API
```

需要完成以下三步配置：
1. 创建飞书应用 + 多维表格
2. 部署 Cloudflare Worker
3. 修改 `config.js` 填入 Worker 地址

### 模式二：本地模式（回退，功能受限）

数据存在 `data.json` 文件中，手动编辑文件来更新。

未配置 `config.js` 中的 `API_BASE_URL` 时自动使用此模式。

---

## 三、飞书配置指南（模式一）

### 第 1 步：创建飞书多维表格

1. 打开 [飞书](https://www.feishu.cn) 并登录
2. 进入「云文档」→「多维表格」，点击「新建」
3. 创建一个表格，添加以下列（**列名必须与下方一致**）：

| 列名 | 字段类型 | 说明 |
| --- | --- | --- |
| 企业名称 | 文本 | 学生搜索的主要依据 |
| 推文标题 | 文本 | 招聘推文标题 |
| 发布日期 | 日期 | 格式：年-月-日 |
| 岗位类别 | 多选 | 支持多个标签，如"国企招聘""技术岗" |
| 推文链接 | 超链接 | 微信推文 URL |

4. 打开表格后，看浏览器地址栏：
   ```
   https://xxx.feishu.cn/base/APP_TOKEN?table=TABLE_ID
   ```
   - `APP_TOKEN` 是 `/base/` 后面的那串字符
   - `TABLE_ID` 是 `?table=` 后面的那串字符
   把这两个值记下来。

### 第 2 步：创建飞书应用

1. 打开 [飞书开放平台](https://open.feishu.cn/app) 并登录
2. 点击「创建企业自建应用」
3. 填写应用名称（如"就业信息查询"）和描述
4. 创建后进入应用详情页，记录以下信息：
   - **App ID**（如 `cli_a1b2c3d4`）
   - **App Secret**（如 `xxx_secret_xxx`）
5. 在左侧菜单找到「权限管理」，搜索并开通以下权限：
   - `bitable:app` — 查看、评论、编辑和管理多维表格
   - `bitable:app:readonly` — 查看多维表格（至少需要这个）
6. 在「权限管理」→「数据使用」中，申请添加你的多维表格为数据源（或确保应用有权限访问）
7. 发布应用版本并等待管理员审批通过（如果是个人测试环境可能自动通过）

### 第 3 步：部署 Cloudflare Worker

1. 注册 [Cloudflare](https://dash.cloudflare.com) 账号（免费）
2. 安装 Node.js（如已有可跳过）
3. 在 `worker/` 目录下打开终端：
   ```bash
   # 安装 wrangler CLI
   npm install
   
   # 登录 Cloudflare
   npx wrangler login
   
   # 设置敏感密钥（会提示输入值）
   npx wrangler secret put FEISHU_APP_SECRET    # 粘贴 App Secret
   npx wrangler secret put ADMIN_TOKEN          # 自定义一个管理令牌（如 my-secret-2026）
   ```
4. 编辑 `worker/wrangler.toml`，填入非敏感配置：
   ```toml
   [vars]
   FEISHU_APP_ID = "cli_xxxxxx"
   FEISHU_APP_TOKEN = "xxxxxx"
   FEISHU_TABLE_ID = "tblxxxxxx"
   ```
5. 部署：
   ```bash
   npx wrangler deploy
   ```
6. 部署成功后，你会得到一个 Worker 地址，形如：
   ```
   https://feishu-jobs-api.your-name.workers.dev
   ```
7. 验证：浏览器访问 `https://feishu-jobs-api.your-name.workers.dev/api/health`，应返回 `{"success":true}`

### 第 4 步：配置前端

打开 `config.js`，填入你的 Worker 地址和管理令牌：

```javascript
const CONFIG = {
  API_BASE_URL: "https://feishu-jobs-api.your-name.workers.dev",
  ADMIN_TOKEN: "my-secret-2026",
  PAGE_SIZE: 20,
  SEARCH_DEBOUNCE: 150,
};
```

### 第 5 步：更新到 GitHub

把修改后的 `index.html`、`config.js`、`worker/` 推送到 GitHub，EdgeOne 会自动更新。

---

## 四、功能说明

### 学生使用

- **搜索**：输入企业名称，自动模糊匹配，关键词高亮
- **分类筛选**：点击标签按钮按岗位类别筛选
- **日期范围**：选择起止日期过滤招聘信息
- **排序**：按最新发布 / 最早发布 / 企业名排序
- **分页**：大数据量自动分页，每页 20 条
- **导出**：将当前搜索结果导出为 CSV（Excel 可直接打开）
- **分享**：生成带搜索条件的分享链接，可复制或系统分享

### 辅导员使用

- 点击右上角「管理」按钮
- 输入管理令牌登录
- 可新增、编辑、删除招聘信息（写入飞书多维表格，实时生效）
- 也可直接在飞书表格中操作，页面刷新后自动同步

---

## 五、本地预览

因为浏览器安全限制，直接双击 `index.html` 可能读不到 `data.json`。
需要用本地服务器预览：

```bash
# 在本文件夹里打开终端
python -m http.server 8000
```
然后浏览器打开 http://localhost:8000

---

## 六、安全说明

- **App Secret 和管理令牌**只存在 Cloudflare Worker 的环境变量中，不会暴露在前端
- 前端的 `ADMIN_TOKEN` 用于辅导员登录验证，实际 API 写操作由 Worker 端校验
- Worker 设置了 CORS 允许跨域，只有配置了正确管理令牌的请求才能增删改数据
- 学生查询（GET）无需鉴权，任何人可访问

---

## 七、后续迭代方向

- 飞书多维表格字段名映射可在 Worker 中自定义（见 `FIELD_MAP`）
- 增加更多筛选维度（如企业性质、工作地点）
- 接入飞书 Webhook，数据变更时自动通知
- 移动端无限滚动优化

> AI生成