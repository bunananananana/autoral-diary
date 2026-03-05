# Autoral 日记本

极简桌面日记小工具，常驻桌面随时记录。支持 Windows / macOS / Linux。

## 功能

- **桌面组件** — 300×300 半透明小窗口，快速记录今日日记
- **系统托盘** — 图标常驻任务栏，点击打开完整日记本
- **完整日记本** — 左侧日期列表 + 右侧 Markdown 编辑/预览
- **日历检索** — 按日期浏览，有记录的日期标记小圆点
- **搜索** — 快速检索历史日记内容
- **Markdown** — 支持标题、列表、代码块、分隔线等
- **自动保存** — 输入后自动保存，无需手动操作
- **横线标记** — 编辑器带横线，模拟笔记本效果
- **个性化背景** — 可上传图片自定义桌面组件背景

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl/Cmd+Shift+D` | 显示/隐藏桌面组件 |
| `Ctrl/Cmd+S` | 手动保存 |
| `Ctrl/Cmd+P` | 切换编辑/预览模式 |

## 安装使用

### 直接下载

前往 [Releases](https://github.com/bunananananana/autoral-diary/releases) 页面下载：

- **Windows**: `.exe` 安装版 或 便携版
- **macOS**: `.dmg` 安装包
- **Linux**: `.AppImage` 或 `.deb`

### 从源码运行

```bash
git clone https://github.com/bunananananana/autoral-diary.git
cd autoral-diary
npm install
npm start
```

## 打包构建

```bash
# Windows（在 Windows 上执行）
npm run build

# macOS（在 macOS 上执行）
npm run build:mac

# Linux（在 Linux 上执行）
npm run build:linux
```

> macOS 打包必须在 macOS 系统上执行（Apple 签名机制要求）。

## 数据存储

日记以 JSON 文件保存在本地，每天一个文件：

| 系统 | 路径 |
|------|------|
| Windows | `%APPDATA%/autoral-diary/diaries/` |
| macOS | `~/Library/Application Support/autoral-diary/diaries/` |
| Linux | `~/.config/autoral-diary/diaries/` |
