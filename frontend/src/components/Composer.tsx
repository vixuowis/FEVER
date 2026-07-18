import { useEffect, useRef, useState } from "react";
import { SendHorizontal, Square, Users, Zap, UserCircle2, ChevronDown } from "lucide-react";
import { cls } from "../utils";
import { useStore } from "../store";
import type { Mode } from "../types";

/** 底部输入区：
 *  - 模式 segmented（auto/agent/team）
 *  - agent 模式时下方独立一行放 Agent 下拉（避免被 textarea 遮挡）
 *  - 自动增高 textarea + 发送/停止 */
export default function Composer() {
  const [text, setText] = useState("");
  const [agentOpen, setAgentOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const agentRef = useRef<HTMLDivElement>(null);
  const streaming = useStore((s) => s.streaming);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const sendMessage = useStore((s) => s.sendMessage);
  const stop = useStore((s) => s.stop);
  const agents = useStore((s) => s.agents);
  const selectedAgent = useStore((s) => s.selectedAgent);
  const setSelectedAgent = useStore((s) => s.setSelectedAgent);

  // 自动增高
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = Math.min(ta.scrollHeight, 180) + "px";
  }, [text]);

  // 点击外部关闭 agent 下拉
  useEffect(() => {
    if (!agentOpen) return;
    const onClick = (e: MouseEvent) => {
      if (agentRef.current && !agentRef.current.contains(e.target as Node)) {
        setAgentOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [agentOpen]);

  const canSend = text.trim().length > 0 && !streaming;
  const currentAgent = agents.find((a) => a.id === selectedAgent) || agents[0];
  // 过滤出可单独调度的"前台"专家（去掉内部调度/调度辅助 agent）
  const dispatchableAgents = agents.filter(
    (a) =>
      !["router", "planner", "synthesizer", "verifier", "report_writer"].includes(a.id),
  );

  const doSend = () => {
    if (!canSend) return;
    const t = text.trim();
    setText("");
    void sendMessage(t);
  };

  const modes: { id: Mode; label: string; icon: React.ReactNode; hint: string; color: string }[] = [
    { id: "auto", label: "快速问答", icon: <Zap size={13} />, hint: "主理人 · 工具循环", color: "bg-brand" },
    { id: "agent", label: "单 Agent", icon: <UserCircle2 size={13} />, hint: "直接调度单个专家", color: "bg-violet" },
    { id: "team", label: "深度研究团队", icon: <Users size={13} />, hint: "Planner + 专家 + 复核", color: "bg-jade" },
  ];

  const placeholder =
    mode === "team"
      ? "提出一个需要多角度深挖的问题，研究团队会并行展开…"
      : mode === "agent" && currentAgent
        ? `直接问「${currentAgent.name}」…（${currentAgent.description.split("：")[0].slice(0, 28)}）`
        : "询问任何财经事件、行情、公告、宏观问题…";

  return (
    <div className="border-t border-edge bg-paper/90 px-4 pb-4 pt-3 backdrop-blur">
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-card border border-edge bg-card shadow-card transition-shadow focus-within:shadow-pop focus-within:border-edgeDark">
          {/* 模式切换（独占一行） */}
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
                      ? cls(m.color, "text-card shadow-sm")
                      : "text-mute hover:text-ink",
                  )}
                >
                  {m.icon}
                  {m.label}
                </button>
              ))}
            </div>
            <span className="hidden text-[11px] text-faint sm:block">
              {mode === "team" ? "Planner 拆解 · 专家串行 · 复核" :
               mode === "agent" ? `单 Agent · ≤8 轮工具循环` :
               "主理人 · ≤8 轮工具循环"}
            </span>
          </div>

          {/* agent 模式：单独一行放 Agent 下拉（不会被 textarea 遮挡） */}
          {mode === "agent" && (
            <div className="px-3 pt-1.5">
              <div className="relative" ref={agentRef}>
                <button
                  onClick={() => setAgentOpen((v) => !v)}
                  disabled={agents.length === 0}
                  className="flex w-full items-center gap-2 rounded-lg border border-violet/40 bg-violet/5 px-2.5 py-1.5 text-[12px] font-medium text-violet transition-colors hover:bg-violet/10"
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: currentAgent?.avatar_color || "#7C3AED" }}
                  />
                  <span className="flex-1 truncate text-left">
                    {currentAgent?.name || "选择 Agent"}
                    {currentAgent && (
                      <span className="ml-1.5 text-[10.5px] font-normal text-faint">
                        · {currentAgent.description.split("：")[0].slice(0, 30)}
                      </span>
                    )}
                  </span>
                  <ChevronDown size={12} className={cls("transition-transform", agentOpen && "rotate-180")} />
                </button>
                {agentOpen && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-card border border-edge bg-card shadow-pop">
                    {dispatchableAgents.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => { setSelectedAgent(a.id); setAgentOpen(false); }}
                        className={cls(
                          "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-page",
                          selectedAgent === a.id && "bg-violet/5",
                        )}
                      >
                        <span
                          className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{ background: a.avatar_color }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] font-medium text-ink">{a.name}</div>
                          <div className="mt-0.5 line-clamp-2 text-[10.5px] text-faint">{a.description}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

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
            placeholder={placeholder}
            className="mt-2 block w-full resize-none bg-transparent px-4 py-2.5 text-[14px] leading-relaxed text-ink placeholder:text-faint focus:outline-none"
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
