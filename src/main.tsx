import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import App from "./App";
import Settings from "./Settings";

/**
 * 应用入口文件只做三件事：
 * 1. 挂载 React 根节点。
 * 2. 初始化路由容器。
 * 3. 把聊天页和设置页注册成两个明确的桌面端页面。
 *
 * 这样每个页面组件都可以只专注自己的业务，不需要在入口文件里混杂逻辑。
 */
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
