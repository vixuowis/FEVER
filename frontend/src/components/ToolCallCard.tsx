import { useState } from "react";
import { Check, ChevronRight, Loader2, Wrench, X, PanelRightOpen } from "lucide-react";
import type { Part } from "../types";
import { agentColor, agentName, skillCn } from "../names";
import { argsSummary, cls } from "../utils";
import { useStore } from "../store";

type ToolPart = Extract<Part, { type: "tool_call" }>;

/** 工具调用卡片：running→done 状态动画，可展开 args / preview；team 模式带 agent 色条 */
export default function ToolCallCard({ part, showAgent }: { part: ToolPart; showAgent?: boolean }) {
  const [open, setOpen] = useState(false);
  const agents = useStore((s) => s.agents);
  const artifacts = useStore((s) => s.artifacts);
  const selectArtifact = useStore((s) => s.selectArtifact);

  const color = showAgent && part.agent ? agentColor(part.agent, agents) : undefined;
  const linked = part.artifactId ? artifacts.find((a) => a.id === part.artifactId) : undefined;
  const summary = argsSummary(part.args);

  return (
    <div
      className={cls(
        "group relative overflow-hidden rounded-card border border-edge bg-card shadow-card transition-colors",
        part.status === "running" && "border-brand/40",
      )}
      style={color ? { borderLeftWidth: 3, borderLeftColor: color } : undefined}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-[#FBFAF8] transition-colors"
      >
        {/* 状态点 */}
        {part.status === "running" ? (
          <Loader2 size={14} className="shrink-0 animate-spin text-brand" />
        ) : part.status === "done" ? (
          <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-jade-soft">
            <Check size={11} strokeWidth={3} className="text-jade" />
          </span>
        ) : (
          <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-rise/10">
            <X size={11} strokeWidth={3} className="text-rise" />
          </span>
        )}

        <Wrench size={13} className="shrink-0 text-faint" />
        <span className="text-[13px] font-medium text-ink">{skillCn(part.skill)}</span>
        <span className="font-mono text-[11px] text-faint">{part.skill}</span>

        {showAgent && part.agent && (
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{ color, backgroundColor: `${color}14` }}
          >
            {agentName(part.agent, agents)}
          </span>
        )}

        {summary && !open && (
          <span className="min-w-0 flex-1 truncate text-right text-[11.5px] text-faint">{summary}</span>
        )}
        <ChevronRight
          size={14}
          className={cls("ml-auto shrink-0 text-faint transition-transform duration-200", open && "rotate-90")}
        />
      </button>

      {open && (
        <div className="space-y-2 border-t border-edge/70 px-3.5 py-3 animate-fadeUp">
          {part.args && Object.keys(part.args).length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-faint">参数</div>
              <pre className="overflow-x-auto rounded-lg border border-edge bg-[#F7F5F2] px-3 py-2 font-mono text-[12px] leading-relaxed text-mute">
                {JSON.stringify(part.args, null, 2)}
              </pre>
            </div>
          )}
          {part.preview && (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-faint">结果</div>
              <p className="text-[12.5px] leading-relaxed text-mute whitespace-pre-wrap">{part.preview}</p>
            </div>
          )}
          {linked && (
            <button
              onClick={() => selectArtifact(linked.id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-jade/30 bg-jade-soft px-2.5 py-1.5 text-[12px] font-medium text-jade hover:bg-jade hover:text-card transition-colors"
            >
              <PanelRightOpen size={13} />
              查看产出物：{linked.title}
            </button>
          )}
          {!part.preview && part.status === "running" && (
            <p className="text-[12px] text-faint">执行中，通常需要几秒到一分钟…</p>
          )}
        </div>
      )}
    </div>
  );
}
