import { useEffect, useRef, useState } from "react";
import { SendHorizontal, Square, Users, Zap } from "lucide-react";
import { cls } from "../utils";
import { useStore } from "../store";
import type { Mode } from "../types";

/** 底部输入区：模式 segmented + 自动增高 textarea + 发送/停止 */
export default function Composer() {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const streaming = useStore((s) => s.streaming);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const sendMessage = useStore((s) => s.sendMessage);
  const stop = useStore((s) => s.stop);

  // 自动增高
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = Math.min(ta.scrollHeight, 180) + "px";
  }, [text]);

  const canSend = text.trim().length > 0 && !streaming;

  const doSend = () => {
    if (!canSend) return;
    const t = text.trim();
    setText("");
    void sendMessage(t);
  };

  const modes: { id: Mode; label: string; icon: React.ReactNode; hint: string }[] = [
    { id: "auto", label: "快速问答", icon: <Zap size={13} />, hint: "单个主理人 + 工具循环" },
    { id: "team", label: "深度研究团队", icon: <Users size={13} />, hint: "多专家并行 + 复核" },
  ];

  return (
    <div className="border-t border-edge bg-paper/90 px-4 pb-4 pt-3 backdrop-blur">
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-card border border-edge bg-card shadow-card transition-shadow focus-within:shadow-pop focus-within:border-edgeDark">
          {/* 模式切换 */}
          <div className="flex items-center justify-between px-3 pt-2.5">
            <div className="flex rounded-lg border border-edge bg-paper p-0.5" role="tablist">
              {modes.map((m) => (
                <button
                  key={m.id}
                  role="tab"
                  aria-selected={mode === m.id}
                  title={m.hint}
                  onClick={() => setMode(m.id)}
                  className={cls(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-all duration-200",
                    mode === m.id
                      ? m.id === "team"
                        ? "bg-jade text-card shadow-sm"
                        : "bg-brand text-card shadow-sm"
                      : "text-mute hover:text-ink",
                  )}
                >
                  {m.icon}
                  {m.label}
                </button>
              ))}
            </div>
            <span className="hidden text-[11px] text-faint sm:block">
              {mode === "team" ? "Planner 拆解任务 · 专家并行 · 复核" : "主理人 Agent · ≤8 轮工具循环"}
            </span>
          </div>

          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                doSend();
              }
            }}
            rows={1}
            placeholder={
              mode === "team"
                ? "提出一个需要多角度深挖的问题，研究团队会并行展开…"
                : "询问任何财经事件、行情、公告、宏观问题…"
            }
            className="mt-1 block w-full resize-none bg-transparent px-4 py-2.5 text-[14px] leading-relaxed text-ink placeholder:text-faint focus:outline-none"
          />

          <div className="flex items-center justify-between px-3 pb-2.5">
            <span className="text-[11px] text-faint">Enter 发送 · Shift+Enter 换行 · 数据来自 akshare 真实接口</span>
            {streaming ? (
              <button
                onClick={stop}
                className="flex items-center gap-1.5 rounded-lg border border-rise/40 bg-rise/5 px-3 py-1.5 text-[12.5px] font-medium text-rise transition-colors hover:bg-rise hover:text-card"
              >
                <Square size={12} fill="currentColor" />
                停止
              </button>
            ) : (
              <button
                onClick={doSend}
                disabled={!canSend}
                className={cls(
                  "flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-medium transition-all duration-200",
                  canSend
                    ? "bg-brand text-card hover:bg-brand-hover shadow-sm"
                    : "cursor-not-allowed bg-edge/60 text-faint",
                )}
              >
                <SendHorizontal size={13} />
                发送
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
