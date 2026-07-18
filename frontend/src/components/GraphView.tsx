import { useState } from "react";
import { ChevronDown, ChevronRight, Network, CheckCircle2, AlertTriangle, HelpCircle, XCircle } from "lucide-react";
import Markdown from "./Markdown";
import { cls } from "../utils";

/** 证据图（EvidenceGraph）渲染。payload 结构见 evidence_graph.EvidenceGraph.to_payload() */
export default function GraphView({ payload }: { payload: any }) {
  const stats = payload?.stats || {};
  const nodes: any[] = payload?.nodes || [];
  const edges: any[] = payload?.edges || [];
  const missing: any[] = payload?.missing || [];
  const sufficient: boolean = !!payload?.sufficient;
  const question: string = payload?.question || "";
  const scope: string = payload?.scope || "";
  const stopReason: string = payload?.stop_reason || "";
  const markdown: string = payload?.markdown || "";
  const [showNodes, setShowNodes] = useState(false);
  const [showEdges, setShowEdges] = useState(false);

  const claimStatus = stats.claim_status || {};

  return (
    <div className="space-y-3 text-[12.5px] leading-relaxed text-ink">
      {/* 头部：标题 + 范围 */}
      {(question || scope) && (
        <div className="rounded-card border border-edge bg-card p-3 shadow-card">
          <div className="mb-1 flex items-center gap-2 text-[12px] font-medium text-mute">
            <Network size={14} className="text-brand" />
            <span>证据图</span>
          </div>
          {question && (
            <div className="font-serif text-[14px] font-semibold text-ink">{question}</div>
          )}
          {scope && <div className="mt-1 text-[11.5px] text-faint">范围：{scope}</div>}
        </div>
      )}

      {/* 统计卡 */}
      <div className="grid grid-cols-4 gap-2">
        <StatChip label="证据" value={stats.n_evidence || 0} />
        <StatChip label="推论" value={stats.n_claim || 0} />
        <StatChip label="边" value={stats.n_edges || 0} />
        <StatChip label="缺口" value={stats.n_missing || 0} />
      </div>

      {/* claim 状态分布 */}
      {Object.keys(claimStatus).length > 0 && (
        <div className="rounded-card border border-edge bg-card p-3 shadow-card">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">
            推论状态
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(claimStatus).map(([k, v]) => (
              <ClaimStatusChip key={k} status={k} count={v as number} />
            ))}
          </div>
        </div>
      )}

      {/* 充分状态 */}
      <div
        className={cls(
          "flex items-center gap-2 rounded-card border px-3 py-2 text-[12px]",
          sufficient
            ? "border-jade/40 bg-jade-soft text-jade"
            : "border-amber/40 bg-amber-soft text-amber",
        )}
      >
        {sufficient ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
        <span>
          {sufficient
            ? `研究已充分${stopReason ? `（${stopReason}）` : ""}`
            : "研究尚未充分——可继续添加证据或标记缺口"}
        </span>
      </div>

      {/* markdown 摘要 */}
      {markdown && (
        <div className="rounded-card border border-edge bg-card p-3.5 shadow-card">
          <Markdown text={markdown} />
        </div>
      )}

      {/* 节点列表（折叠） */}
      {nodes.length > 0 && (
        <div className="rounded-card border border-edge bg-card shadow-card">
          <button
            onClick={() => setShowNodes((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-medium text-mute hover:bg-page"
          >
            {showNodes ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            节点列表（{nodes.length}）
          </button>
          {showNodes && (
            <ul className="space-y-1.5 border-t border-edge px-3 py-2 text-[12px]">
              {nodes.map((n) => (
                <li key={n.id} className="flex items-start gap-2">
                  <NodeKindBadge kind={n.kind} status={n.status} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink">{n.title}</div>
                    {n.body && (
                      <div className="mt-0.5 line-clamp-2 text-[11.5px] text-faint">
                        {n.body}
                      </div>
                    )}
                    {n.source_ref && (
                      <div className="mt-0.5 font-mono text-[11px] text-faint">
                        src: {n.source_ref}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 边列表（折叠） */}
      {edges.length > 0 && (
        <div className="rounded-card border border-edge bg-card shadow-card">
          <button
            onClick={() => setShowEdges((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-medium text-mute hover:bg-page"
          >
            {showEdges ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            关系边（{edges.length}）
          </button>
          {showEdges && (
            <ul className="space-y-1 border-t border-edge px-3 py-2 text-[12px]">
              {edges.map((e, i) => (
                <li key={i} className="flex items-center gap-2 font-mono text-[11.5px]">
                  <EdgeRelationChip relation={e.relation} />
                  <span className="text-ink">{e.src}</span>
                  <span className="text-faint">→</span>
                  <span className="text-ink">{e.dst}</span>
                  {e.note && <span className="text-faint">· {e.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* missing 单独提示（如果没折叠展开） */}
      {!showNodes && missing.length > 0 && (
        <div className="rounded-card border border-amber/40 bg-amber-soft p-3 text-[12px] text-amber">
          <div className="mb-1 font-medium">研究缺口（{missing.length}）</div>
          <ul className="space-y-0.5">
            {missing.slice(0, 3).map((m) => (
              <li key={m.id} className="flex items-start gap-1.5">
                <HelpCircle size={12} className="mt-0.5 shrink-0" />
                <span>{m.title}</span>
              </li>
            ))}
            {missing.length > 3 && (
              <li className="text-faint">...还有 {missing.length - 3} 项</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-edge bg-card px-2.5 py-2 text-center shadow-sm">
      <div className="text-[18px] font-semibold leading-none text-ink">{value}</div>
      <div className="mt-1 text-[10.5px] uppercase tracking-wide text-faint">{label}</div>
    </div>
  );
}

function ClaimStatusChip({ status, count }: { status: string; count: number }) {
  const meta: Record<string, { label: string; color: string; icon: any }> = {
    verified: { label: "已验证", color: "bg-jade-soft text-jade border-jade/40", icon: CheckCircle2 },
    rejected: { label: "已否定", color: "bg-rose-soft text-rose border-rose/40", icon: XCircle },
    needs_more: { label: "待补充", color: "bg-amber-soft text-amber border-amber/40", icon: HelpCircle },
    insufficient: { label: "证据不足", color: "bg-rose-soft text-rose border-rose/40", icon: AlertTriangle },
    exploring: { label: "探索中", color: "bg-brand-soft text-brand border-brand/30", icon: HelpCircle },
  };
  const m = meta[status] || { label: status, color: "bg-edge text-mute border-edge", icon: HelpCircle };
  const Icon = m.icon;
  return (
    <span
      className={cls(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
        m.color,
      )}
    >
      <Icon size={11} />
      {m.label} · {count}
    </span>
  );
}

function NodeKindBadge({ kind, status }: { kind: string; status?: string }) {
  if (kind === "evidence") {
    return <span className="mt-0.5 inline-block rounded bg-brand-soft px-1.5 py-0.5 text-[10px] text-brand">证据</span>;
  }
  if (kind === "claim") {
    const colors: Record<string, string> = {
      verified: "bg-jade-soft text-jade",
      rejected: "bg-rose-soft text-rose",
      needs_more: "bg-amber-soft text-amber",
      insufficient: "bg-rose-soft text-rose",
      exploring: "bg-brand-soft text-brand",
    };
    return (
      <span
        className={cls(
          "mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px]",
          colors[status || "exploring"] || "bg-edge text-mute",
        )}
      >
        推论
      </span>
    );
  }
  if (kind === "missing") {
    return <span className="mt-0.5 inline-block rounded bg-amber-soft px-1.5 py-0.5 text-[10px] text-amber">缺口</span>;
  }
  return <span className="mt-0.5 inline-block rounded bg-edge px-1.5 py-0.5 text-[10px] text-mute">{kind}</span>;
}

function EdgeRelationChip({ relation }: { relation: string }) {
  const meta: Record<string, string> = {
    supports: "bg-jade-soft text-jade",
    contradicts: "bg-rose-soft text-rose",
    context: "bg-page text-mute",
    addresses: "bg-brand-soft text-brand",
  };
  const label: Record<string, string> = {
    supports: "支持",
    contradicts: "反驳",
    context: "上下文",
    addresses: "对应",
  };
  return (
    <span
      className={cls(
        "inline-block rounded px-1.5 py-0.5 text-[10px]",
        meta[relation] || "bg-edge text-mute",
      )}
    >
      {label[relation] || relation}
    </span>
  );
}
