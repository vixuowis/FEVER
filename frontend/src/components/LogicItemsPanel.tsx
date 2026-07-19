import { useState } from "react";
import {
  AlertTriangle,
  Beaker,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Clock,
  History,
  Hourglass,
  Loader2,
  Sparkles,
  Wand2,
  XCircle,
} from "lucide-react";
import type {
  LogicItem,
  LogicStatus,
} from "../types";
import { useStore } from "../store";
import { cls, relTime } from "../utils";

/** 类别 / 状态 → 中文 + 配色 */
const CATEGORY_LABEL: Record<string, string> = {
  情景: "情景",
  条件预测: "条件预测",
  时间窗口: "时间窗口",
  反方观点: "反方观点",
  量化阈值: "量化阈值",
};

const STATUS_META: Record<
  LogicStatus,
  { label: string; chip: string; icon: React.ReactNode; tone: string }
> = {
  pending: {
    label: "待验证",
    chip: "border-brand/30 bg-brand-soft/60 text-brand",
    icon: <CircleDashed size={11} />,
    tone: "text-brand",
  },
  pending_scheduled: {
    label: "窗口未到",
    chip: "border-faint/40 bg-[#F4F2EE] text-faint",
    icon: <Hourglass size={11} />,
    tone: "text-faint",
  },
  verified: {
    label: "已证实",
    chip: "border-jade/30 bg-jade-soft/70 text-jade",
    icon: <CheckCircle2 size={11} />,
    tone: "text-jade",
  },
  rejected: {
    label: "已证伪",
    chip: "border-rise/30 bg-rise/10 text-rise",
    icon: <XCircle size={11} />,
    tone: "text-rise",
  },
  inconclusive: {
    label: "暂无法验证",
    chip: "border-amber/30 bg-amber-soft/60 text-amber",
    icon: <AlertTriangle size={11} />,
    tone: "text-amber",
  },
  dismissed: {
    label: "已忽略",
    chip: "border-edge bg-card text-faint",
    icon: <CircleDashed size={11} />,
    tone: "text-faint",
  },
};

/** 「待时间到了再次验证」的时间显示（绝对 + 相对） */
function nextCheckLabel(nextISO: string | null | undefined): string {
  if (!nextISO) return "—";
  const t = new Date(nextISO).getTime();
  if (Number.isNaN(t)) return "—";
  const ms = t - Date.now();
  if (ms <= 0) return "已可验证";
  return relTime(nextISO);
}

/** 单条 hypothesis 卡片：可折叠、内含「深度验证 / 验证为真 / 为伪 / 忽略 / 再次追踪 / 历史」 */
function LogicCard({ item }: { item: LogicItem }) {
  // 始终从 store 拿最新条目，避免在消息流快照路径下点击后 UI 不刷新
  const live = useStore((s) => s.logicLibrary.find((x) => x.id === item.id));
  const itemLive: LogicItem = live ?? item;
  const updateLogicItem = useStore((s) => s.updateLogicItem);
  const dismissLogicItem = useStore((s) => s.dismissLogicItem);
  const reverifyLogic = useStore((s) => s.reverifyLogic);
  const autoCheckLogic = useStore((s) => s.autoCheckLogic);
  const markLogicCheck = useStore((s) => s.markLogicCheck);
  const checking = useStore((s) => s.logicChecking.has(item.id));
  const [expanded, setExpanded] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const meta = STATUS_META[itemLive.status] ?? STATUS_META.pending;
  const cat = CATEGORY_LABEL[itemLive.category] ?? itemLive.category ?? "推演";

  const onAutoCheck = () => {
    if (checking) return;
    void autoCheckLogic(item.id);
  };
  const onMarkVerified = () => markLogicCheck(item.id, "verified");
  const onMarkRejected = () => markLogicCheck(item.id, "rejected");
  const onResetPending = () =>
    updateLogicItem(item.id, {
      status: "pending",
      verified_at: null,
      next_check_at: null,
    });

  const lastAuto = itemLive.check_history?.find((e) => e.source === "auto");
  const showNextSchedule = itemLive.status === "pending_scheduled" && itemLive.next_check_at;

  return (
    <div
      className={cls(
        "rounded-lg border bg-card transition-colors",
        itemLive.status === "pending" && "border-brand/25",
        itemLive.status === "pending_scheduled" && "border-faint/30",
        itemLive.status === "verified" && "border-jade/30",
        itemLive.status === "rejected" && "border-rise/30",
        itemLive.status === "inconclusive" && "border-amber/30",
        itemLive.status === "dismissed" && "border-edge opacity-70",
      )}
    >
      {/* 顶部：hypothesis + 状态 chip */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
      >
        <span className={cls("mt-0.5", meta.tone)}>
          <Beaker size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span
              className={cls(
                "inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium",
                meta.chip,
              )}
            >
              {meta.icon}
              {meta.label}
            </span>
            <span className="rounded bg-[#F4F2EE] px-1.5 py-px text-[10px] font-medium text-mute">
              {cat}
            </span>
            {itemLive.probability && (
              <span className="text-[10px] text-faint">· 概率 {itemLive.probability}</span>
            )}
            {showNextSchedule && (
              <span className="inline-flex items-center gap-1 text-[10px] text-faint">
                <Clock size={9} />
                {nextCheckLabel(itemLive.next_check_at)} 再验
              </span>
            )}
          </span>
          <span className="mt-1 block text-[13px] leading-[1.7] text-ink">
            {itemLive.hypothesis}
          </span>
        </span>
        <span className="mt-0.5 shrink-0 text-faint">
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </button>

      {/* 展开区 */}
      {expanded && (
        <div className="space-y-1.5 border-t border-edge/60 px-3 py-2 text-[11.5px] leading-[1.7] text-mute">
          {itemLive.scope && (
            <div>
              <span className="text-faint">范围：</span>
              <span className="text-ink/85">{itemLive.scope}</span>
            </div>
          )}
          {itemLive.horizon && (
            <div>
              <span className="text-faint">窗口：</span>
              <span className="text-ink/85">{itemLive.horizon}</span>
            </div>
          )}
          {itemLive.check && (
            <div>
              <span className="text-faint">验证：</span>
              <span className="text-ink/85">{itemLive.check}</span>
            </div>
          )}
          {itemLive.question && (
            <div className="border-t border-edge/40 pt-1.5 text-faint">
              来自问题：<span className="italic">「{itemLive.question}」</span>
            </div>
          )}

          {/* 最近一次自动验证的 reasoning / data_summary */}
          {lastAuto && (
            <div className="mt-1 rounded-md border border-edge/60 bg-[#FBFAF8] px-2.5 py-2">
              <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-medium text-mute">
                <Wand2 size={10} />
                深度验证 · {relTime(lastAuto.at)}
                <span className={cls("ml-auto", STATUS_META[lastAuto.verdict as LogicStatus]?.tone ?? "")}>
                  {STATUS_META[lastAuto.verdict as LogicStatus]?.label ?? lastAuto.verdict}
                </span>
              </div>
              {lastAuto.data_summary && (
                <div className="text-[11.5px] text-ink/85">{lastAuto.data_summary}</div>
              )}
              {lastAuto.reasoning && (
                <div className="mt-0.5 text-[11px] leading-[1.7] text-mute">
                  {lastAuto.reasoning}
                </div>
              )}
              {lastAuto.evidence && lastAuto.evidence.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {lastAuto.evidence.map((ev, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded bg-[#F4F2EE] px-1.5 py-px text-[10px] text-mute"
                      title={ev.summary}
                    >
                      <span className={ev.ok ? "text-jade" : "text-rise"}>
                        {ev.ok ? "✓" : "✕"}
                      </span>
                      {ev.skill}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 验证历史（折叠） */}
          {itemLive.check_history && itemLive.check_history.length > 1 && (
            <div className="border-t border-edge/40 pt-1.5">
              <button
                onClick={() => setShowHistory((v) => !v)}
                className="inline-flex items-center gap-1 text-[10.5px] text-faint hover:text-ink"
              >
                <History size={10} />
                历史记录（{itemLive.check_history.length}）
                {showHistory ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              </button>
              {showHistory && (
                <div className="mt-1 space-y-1">
                  {itemLive.check_history.slice(1).map((h, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-1.5 rounded border border-edge/40 bg-[#FBFAF8] px-2 py-1"
                    >
                      <span
                        className={cls(
                          "shrink-0 rounded px-1 py-px text-[9.5px] font-medium",
                          (STATUS_META[h.verdict as LogicStatus]?.chip ?? "border-edge bg-card text-faint"),
                        )}
                      >
                        {STATUS_META[h.verdict as LogicStatus]?.label ?? h.verdict}
                      </span>
                      <span className="min-w-0 flex-1 text-[10.5px] leading-[1.6] text-mute">
                        <span className="text-faint">{relTime(h.at)} · </span>
                        {h.data_summary || h.reasoning}
                      </span>
                      <span className="shrink-0 text-[9.5px] text-faint">
                        {h.source === "auto" ? "自动" : "手动"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-edge/40 pt-1.5">
            <button
              onClick={onAutoCheck}
              disabled={checking}
              className={cls(
                "inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand-soft/60 px-2.5 py-0.5 text-[11px] font-medium text-brand",
                "hover:bg-brand hover:text-card",
                checking && "opacity-70 cursor-wait",
              )}
              title="调取最新市场数据，对照 hypothesis 自动验证（窗口未到会自动转 pending_scheduled）"
            >
              {checking ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />}
              {checking ? "验证中…" : "深度验证"}
            </button>
            {itemLive.status !== "verified" && itemLive.status !== "rejected" && itemLive.status !== "dismissed" && (
              <>
                <button
                  onClick={onMarkVerified}
                  className="rounded-full border border-jade/40 bg-jade-soft/60 px-2 py-0.5 text-[11px] font-medium text-jade hover:bg-jade hover:text-card"
                  title="经过市场验证后，标记为「已证实」"
                >
                  验证为真
                </button>
                <button
                  onClick={onMarkRejected}
                  className="rounded-full border border-rise/40 bg-rise/10 px-2 py-0.5 text-[11px] font-medium text-rise hover:bg-rise hover:text-card"
                  title="市场反向，标记为「已证伪」"
                >
                  验证为伪
                </button>
                <button
                  onClick={() => dismissLogicItem(item.id)}
                  className="rounded-full border border-edge bg-card px-2 py-0.5 text-[11px] text-mute hover:text-rise"
                  title="该推演不重要 / 暂不追踪"
                >
                  忽略
                </button>
              </>
            )}
            {(itemLive.status === "verified" || itemLive.status === "rejected" ||
              itemLive.status === "dismissed" || itemLive.status === "inconclusive" ||
              itemLive.status === "pending_scheduled") && (
              <button
                onClick={onResetPending}
                className="rounded-full border border-edge bg-card px-2 py-0.5 text-[11px] text-mute hover:text-ink"
              >
                重置为待验证
              </button>
            )}
            <button
              onClick={() => reverifyLogic(itemLive)}
              className="ml-auto inline-flex items-center gap-1 rounded-full border border-jade/40 bg-jade-soft/60 px-2 py-0.5 text-[11px] font-medium text-jade hover:bg-jade hover:text-card"
              title="用这条推演作为种子开启新一轮研究"
            >
              <Sparkles size={10} />
              再次追踪
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 嵌入消息流：紧跟主理人结论的「待验证推演」抽屉 */
export default function LogicItemsPanel({ items }: { items: LogicItem[] }) {
  if (!items?.length) return null;
  return (
    <div className="mt-2 rounded-card border border-brand/25 bg-brand-soft/30 p-3 animate-fadeUp">
      <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-brand">
        <Beaker size={14} />
        待验证推演（{items.length}）
        <span className="text-[10.5px] font-normal text-faint">
          · 点击「深度验证」自动取数判断；窗口未到会自动标记为「窗口未到」并预约
        </span>
      </div>
      <div className="space-y-1.5">
        {items.map((it) => (
          <LogicCard key={it.id} item={it} />
        ))}
      </div>
    </div>
  );
}
