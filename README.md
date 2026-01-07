# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## 环境搭建

1. **安装 Node.js 和 pnpm**
   - [Node.js 下载](https://nodejs.org/)
   - 安装 pnpm：

     ```bash
     npm install -g pnpm
     ```

2. **安装 Rust 开发环境**
   - 安装 Rust：

     ```bash
     curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
     ```

   - 配置环境变量：

     ```bash
     
     source $HOME/.cargo/env
     ```

   - 验证安装：

     ```bash
     rustc --version
     ```

3. **安装 Tauri CLI**
   - 安装 Tauri CLI：

     ```bash
     cargo install tauri-cli
     ```

## 项目依赖安装

1. **克隆项目**

   ```bash
   git clone <repository-url>
   cd <project-directory>
   ```

2. **安装依赖**

   ```bash
   pnpm install
   ```

3. **引入图标库**

   ```bash
   pnpm add react-icons
   ```

## 开发环境运行

1. **启动开发服务器**

   ```bash
   pnpm tauri dev
   ```

2. **访问应用**
   - 根据终端输出的地址，打开浏览器访问。

## 构建与部署

1. **构建应用**

   ```bash
   pnpm tauri build
   ```

2. **生成的文件**
   - 构建完成后，生成的安装包位于 `src-tauri/target/release/bundle` 目录下。

3. **部署应用**
   - 将生成的安装包分发给用户，用户安装后即可运行。

## 常见问题

1. **Rust 版本过低**
   - 更新 Rust：

     ```bash
     rustup update
     ```

2. **依赖安装失败**
   - 确保网络畅通，或者使用代理。

3. **构建失败**
   - 检查 `src-tauri/tauri.conf.json` 配置是否正确。
