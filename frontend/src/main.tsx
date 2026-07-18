import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

/**
 * 吞掉「预期内」的 Abort 噪音：
 *  - Vite HMR 重渲染 / StrictMode 双调用 → streamChat 收到 abort
 *  - 浏览器底层把 abort 标记为 net::ERR_ABORTED，DevTools 仍会显示，
 *    但 JS 层 unhandledrejection 的 AbortError / DOMException 我们静默处理
 *  - 用户点击"停止"也是同样的链路
 */
function isExpectedAbort(reason: unknown): boolean {
  if (!reason) return false;
  if (reason instanceof DOMException && reason.name === "AbortError") return true;
  if (reason instanceof Error) {
    const msg = `${reason.name} ${reason.message}`.toLowerCase();
    return msg.includes("abort") || msg.includes("err_aborted");
  }
  if (typeof reason === "string") {
    return reason.toLowerCase().includes("abort");
  }
  return false;
}

window.addEventListener("unhandledrejection", (ev) => {
  if (isExpectedAbort(ev.reason)) {
    ev.preventDefault();
  }
});
window.addEventListener("error", (ev) => {
  if (isExpectedAbort(ev.error) || isExpectedAbort(ev.message)) {
    ev.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
