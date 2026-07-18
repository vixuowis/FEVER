import { useMemo, useState } from "react";
import { AlertTriangle, Beaker, CheckCircle2, CircleDashed, Filter, Hourglass, XCircle } from "lucide-react";
import { useStore } from "../store";
import type { LogicItem, LogicStatus } from "../types";
import { cls, relTime } from "../utils";
import LogicItemsPanel from "./LogicItemsPanel";

/** 库视角：所有 logic items 列表 + 状态筛选 */
export default function LogicLibraryTab() {
  const items = useStore((s) => s.logicLibrary);
  const [filter, setFilter] = useState<LogicStatus | "all">("pending");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((x) => (filter === "all" ? true : x.status === filter))
      .filter((x) =>
        !q
          ? true
          : (x.hypothesis + x.scope + x.horizon + x.check + x.question).toLowerCase().includes(q),
      )
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  }, [items, filter, query]);

  const counts = useMemo(() => {
    const m: Record<LogicStatus | "all", number> = {
      all: items.length,
      pending: 0,
      pending_scheduled: 0,
      verified: 0,
      rejected: 0,
      inconclusive: 0,
      dismissed: 0,
    };
    for (const x of items) m[x.status] += 1;
    return m;
  }, [items]);

  const FILTERS: { id: LogicStatus | "all"; label: string; icon: React.ReactNode }[] = [
    { id: "all", label: "全部", icon: <Beaker size={12} /> },
    { id: "pending", label: "待验证", icon: <CircleDashed size={12} /> },
    { id: "pending_scheduled", label: "窗口未到", icon: <Hourglass size={12} /> },
    { id: "verified", label: "已证实", icon: <CheckCircle2 size={12} /> },
    { id: "rejected", label: "已证伪", icon: <XCircle size={12} /> },
    { id: "inconclusive", label: "暂无法验证", icon: <AlertTriangle size={12} /> },
    { id: "dismissed", label: "已忽略", icon: <CircleDashed size={12} /> },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-edge px-4 py-3.5">
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] font-semibold text-ink">
            研究逻辑库
            <span className="ml-1.5 text-[10.5px] font-normal text-faint">
              {items.length} 条 · 闭环追踪
            </span>
          </span>
        </div>
        <div className="rounded-lg border border-brand/25 bg-brand-soft/40 px-3 py-2 text-[11.5px] leading-[1.8] text-brand">
          团队模式研究结论中的「可证伪推演/情景」会自动入库。
          通过市场验证后，可标记为「已证实 / 已证伪」，形成个人研究逻辑资产。
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <Filter size={12} className="text-faint" />
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cls(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                filter === f.id
                  ? "border-brand/40 bg-brand text-card"
                  : "border-edge bg-card text-mute hover:border-brand/30 hover:text-brand",
              )}
            >
              {f.icon}
              {f.label}
              <span
                className={cls(
                  "rounded-full px-1.5 text-[10px] tabular-nums",
                  filter === f.id ? "bg-card/30" : "bg-[#F4F2EE] text-faint",
                )}
              >
                {counts[f.id]}
              </span>
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索 hypothesis / 范围 / 窗口…"
          className="w-full rounded-lg border border-edge bg-card px-3 py-1.5 text-[12px] text-ink placeholder:text-faint focus:border-brand/40 focus:outline-none"
        />
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {filtered.length === 0 && items.length === 0 && (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center px-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-card border border-dashed border-edgeDark text-faint">
              <Beaker size={20} />
            </span>
            <p className="mt-3 text-[12.5px] leading-relaxed text-faint">
              暂无研究逻辑。
              <br />
              用「研究团队」模式提问后，结论中
              <br />
              可证伪的推演/情景会自动入库。
            </p>
          </div>
        )}
        {filtered.length === 0 && items.length > 0 && (
          <p className="py-8 text-center text-[12px] text-faint">没有匹配的逻辑条目</p>
        )}
        {filtered.map((it: LogicItem) => (
          <div key={it.id} className="rounded-card border border-edge bg-card/60 p-2.5 shadow-card">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] text-faint">
              <span>入库于 {relTime(it.created_at)}</span>
              {it.scope && <span>· {it.scope}</span>}
            </div>
            <LogicItemsPanel items={[it]} />
          </div>
        ))}
      </div>
    </div>
  );
}
