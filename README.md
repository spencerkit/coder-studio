# Coder Studio

> Agent-First Development Environment

本地优先的 AI 编码工作台，将 AI Agent、代码编辑器、Git 和终端整合到统一界面中。

## 特性

- 🤖 **多Agent支持**: Claude、Codex 并行运行
- 📝 **代码编辑**: Monaco Editor + 文件树
- 🔀 **Git集成**: 状态、差异、提交
- 💻 **终端**: xterm.js + PTY
- 🎨 **主题**: 浅色/深色主题切换
- ⌨️ **快捷键**: 自定义快捷键配置
- 🌐 **国际化**: 中文/英文支持

## 安装

```bash
npm install @coder-studio/cli
```

## 使用

```bash
# 启动服务
coder-studio serve

# 指定端口
coder-studio serve --port 3000

# 启用认证
coder-studio serve --password your-password

# 查看帮助
coder-studio --help
```

## 开发

```bash
# 克隆仓库
git clone https://github.com/anthropics/coder-studio.git

# 安装依赖
pnpm install

# 启动开发环境
pnpm dev

# 运行测试
pnpm acceptance:phase1

# 构建CLI
pnpm build:cli
```

## 架构

- **Frontend**: React + Vite + Jotai
- **Backend**: Fastify + WebSocket
- **Terminal**: xterm.js + node-pty
- **Editor**: Monaco Editor
- **Storage**: SQLite (better-sqlite3)

## 文档

- [PRD](docs/PRD.zh-CN.md) - 产品需求文档
- [Design Spec](docs/superpowers/specs/2026-04-13-coder-studio-design.md) - 技术设计文档

## 许可证

MIT