import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X, Check, Bot } from "lucide-react";
import { cls } from "../utils";

interface AgentLite {
  id: string;
  name: string;
  description: string;
  avatar_color?: string;
  skills?: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  agents: AgentLite[];
  selectedId: string;
  onSelect: (id: string) => void;
}

/** Agent 选择对话框：搜索 + 列表 + 详情。Esc / 点击遮罩关闭。 */
export default function AgentPicker({ open, onClose, agents, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 打开时聚焦输入框
  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      // 下一帧 focus，避免 portal 还没挂载
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = agents.filter((a) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      a.name.toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q)
    );
  });

  // 键盘导航
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (filtered.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const pick = filtered[highlight];
        if (pick) {
          onSelect(pick.id);
          onClose();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, filtered, highlight, onSelect, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 px-4 py-8 backdrop-blur-sm animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="选择 Agent"
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-edge bg-card shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-edge px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-soft text-violet">
              <Bot size={15} />
            </span>
            <div>
              <div className="text-[13.5px] font-semibold text-ink">选择 Agent</div>
              <div className="text-[11px] text-faint">直接调度的专家；方向聚焦 + 工具范围收窄</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-mute transition-colors hover:bg-page hover:text-ink"
            title="关闭 (Esc)"
          >
            <X size={14} />
          </button>
        </div>

        {/* 搜索框 */}
        <div className="border-b border-edge bg-page/40 px-5 py-3">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
              placeholder="搜索 Agent（按名称 / id / 描述）"
              className="block w-full rounded-lg border border-edge bg-card py-2 pl-8 pr-3 text-[12.5px] text-ink placeholder:text-faint focus:border-violet/50 focus:outline-none focus:ring-2 focus:ring-violet/20"
            />
          </div>
        </div>

        {/* 列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-card border border-dashed border-edge text-faint">
                <Search size={16} />
              </span>
              <p className="mt-3 text-[12.5px] text-mute">没有匹配的 Agent</p>
              <p className="mt-1 text-[11px] text-faint">试试搜索 "预测" / "行情" / "研究"</p>
            </div>
          ) : (
            <ul className="space-y-1">
              {filtered.map((a, idx) => (
                <li key={a.id}>
                  <button
                    onClick={() => { onSelect(a.id); onClose(); }}
                    onMouseEnter={() => setHighlight(idx)}
                    className={cls(
                      "group flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                      highlight === idx ? "bg-violet/5 ring-1 ring-violet/20" : "hover:bg-page",
                    )}
                  >
                    <span
                      className="mt-0.5 inline-block h-3 w-3 shrink-0 rounded-full ring-2 ring-card"
                      style={{ background: a.avatar_color || "#7C3AED" }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-ink">{a.name}</span>
                        <span className="font-mono text-[10.5px] text-faint">@{a.id}</span>
                        {selectedId === a.id && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-soft px-1.5 py-px text-[10px] font-medium text-violet">
                            <Check size={9} /> 当前
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-mute">
                        {a.description}
                      </p>
                      {a.skills && a.skills.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {a.skills.slice(0, 4).map((s) => (
                            <span
                              key={s}
                              className="rounded bg-page px-1.5 py-px font-mono text-[10px] text-mute"
                            >
                              {s}
                            </span>
                          ))}
                          {a.skills.length > 4 && (
                            <span className="text-[10px] text-faint">+{a.skills.length - 4}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 底部提示 */}
        <div className="flex items-center justify-between border-t border-edge bg-page/40 px-5 py-2.5 text-[11px] text-faint">
          <span>↑↓ 选择 · Enter 确认 · Esc 关闭</span>
          <span>{filtered.length} / {agents.length} 个 Agent</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
