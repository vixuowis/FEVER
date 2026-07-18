import { useState } from "react";
import {
  ArrowLeft,
  Beaker,
  Check,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  PinOff,
  Users,
  Wrench,
} from "lucide-react";
import type { Artifact, EvidencePayload, ReportPayload } from "../types";
import { KIND_CN, skillCn } from "../names";
import { cls, relTime } from "../utils";
import { useStore } from "../store";
import { KindIcon } from "./ArtifactCard";
import KlineChart from "./KlineChart";
import CarChart from "./CarChart";
import DataTable from "./DataTable";
import Markdown from "./Markdown";
import GraphView from "./GraphView";
import LogicLibraryTab from "./LogicLibraryTab";

/* ---------------- 证据卡列表 ---------------- */

function EvidenceView({ payload }: { payload: EvidencePayload }) {
  const items = payload?.items ?? [];
  return (
    <div className="space-y-2.5">
      {items.map((it, i) => (
        <div key={i} className="rounded-card border border-edge bg-card px-3.5 py-3 shadow-card transition-colors hover:border-edgeDark">
          {it.url ? (
            <a
              href={it.url}
              target="_blank"
              rel="noreferrer"
              className="group flex items-start gap-1 text-[13px] font-medium leading-snug text-ink hover:text-jade transition-colors"
            >
              <span className="flex-1">{it.title}</span>
              <ExternalLink size={12} className="mt-1 shrink-0 text-faint group-hover:text-jade" />
            </a>
          ) : (
            <p className="text-[13px] font-medium leading-snug text-ink">{it.title}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
            {it.date && <span>{it.date}</span>}
            <span className="rounded bg-[#F4F2EE] px-1.5 py-px font-mono text-[10.5px] text-mute">{it.source}</span>
          </div>
          {it.snippet && <p className="mt-1.5 line-clamp-3 text-[12px] leading-relaxed text-mute">{it.snippet}</p>}
        </div>
      ))}
      {items.length === 0 && <p className="py-8 text-center text-[12.5px] text-faint">暂无证据条目</p>}
    </div>
  );
}

/* ---------------- 报告视图（markdown + 复制） ---------------- */

function ReportView({ payload }: { payload: ReportPayload }) {
  const [copied, setCopied] = useState(false);
  const md = payload?.markdown ?? "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(md);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = md;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button
          onClick={copy}
          className={cls(
            "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors",
            copied
              ? "border-jade/40 bg-jade-soft text-jade"
              : "border-edge bg-card text-mute hover:border-edgeDark hover:text-ink",
          )}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "已复制" : "复制 markdown"}
        </button>
      </div>
      <div className="rounded-card border border-edge bg-card px-5 py-4 shadow-card">
        <Markdown text={md} />
      </div>
    </div>
  );
}

/* ---------------- artifact 大视图 ---------------- */

function ArtifactDetail({ artifact }: { artifact: Artifact }) {
  const selectArtifact = useStore((s) => s.selectArtifact);
  const pinArtifact = useStore((s) => s.pinArtifact);
  const pinned = !!artifact.pinned;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 pb-3 pt-3.5">
        <button
          onClick={() => selectArtifact(null)}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-edge bg-card text-mute transition-colors hover:text-ink"
          title="返回列表"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-jade-soft text-jade">
          <KindIcon kind={artifact.kind} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-ink">{artifact.title}</p>
          <p className="text-[11px] text-faint">
            {KIND_CN[artifact.kind] ?? artifact.kind} · {relTime(artifact.created_at)}
          </p>
        </div>
        <button
          onClick={() => void pinArtifact(artifact.id)}
          title={pinned ? "取消置顶" : "置顶"}
          className={cls(
            "flex h-7 w-7 items-center justify-center rounded-lg border transition-colors",
            pinned
              ? "border-brand/40 bg-brand-soft text-brand"
              : "border-edge bg-card text-faint hover:text-brand",
          )}
        >
          {pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {artifact.kind === "kline" && (
          <div className="rounded-card border border-edge bg-card p-2 shadow-card">
            <KlineChart payload={artifact.payload} />
          </div>
        )}
        {artifact.kind === "line" && (
          <div className="rounded-card border border-edge bg-card p-2 shadow-card">
            <CarChart payload={artifact.payload} />
          </div>
        )}
        {artifact.kind === "table" && <DataTable payload={artifact.payload} />}
        {artifact.kind === "evidence" && <EvidenceView payload={artifact.payload} />}
        {artifact.kind === "report" && <ReportView payload={artifact.payload} />}
        {artifact.kind === "graph" && <GraphView payload={artifact.payload} />}
      </div>
    </div>
  );
}

/* ---------------- 产出物列表 ---------------- */

function ArtifactList() {
  const artifacts = useStore((s) => s.artifacts);
  const currentCaseId = useStore((s) => s.currentCaseId);
  const selectedId = useStore((s) => s.selectedArtifactId);
  const selectArtifact = useStore((s) => s.selectArtifact);
  const pinArtifact = useStore((s) => s.pinArtifact);
  const genReport = useStore((s) => s.genReport);
  const generatingReport = useStore((s) => s.generatingReport);
  const streaming = useStore((s) => s.streaming);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-2.5 pt-3.5">
        <span className="text-[12px] font-medium text-mute">
          {artifacts.length > 0 ? `${artifacts.length} 件产出物` : "产出物"}
        </span>
        <button
          onClick={() => void genReport()}
          disabled={!currentCaseId || generatingReport || streaming}
          title={currentCaseId ? "基于本研究的全部产出物与对话生成研究报告" : "先开始一个研究"}
          className={cls(
            "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all",
            !currentCaseId || generatingReport || streaming
              ? "cursor-not-allowed bg-edge/50 text-faint"
              : "bg-brand text-card shadow-sm hover:bg-brand-hover",
          )}
        >
          {generatingReport ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
          {generatingReport ? "撰写中…" : "生成研究报告"}
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">
        {artifacts.map((a) => (
          <div key={a.id} className="group relative">
            <button
              onClick={() => selectArtifact(a.id)}
              className={cls(
                "flex w-full items-center gap-3 rounded-card border bg-card px-3 py-2.5 text-left shadow-card transition-all duration-150 hover:-translate-y-px hover:shadow-pop",
                selectedId === a.id ? "border-jade/60 ring-1 ring-jade/30" : "border-edge hover:border-edgeDark",
              )}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-jade-soft text-jade">
                <KindIcon kind={a.kind} size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-ink">
                  {!!a.pinned && <Pin size={10} className="mr-1 inline -translate-y-px text-brand" />}
                  {a.title}
                </span>
                <span className="mt-0.5 block text-[11px] text-faint">
                  {KIND_CN[a.kind] ?? a.kind} · {relTime(a.created_at)}
                </span>
              </span>
            </button>
            <button
              onClick={() => void pinArtifact(a.id)}
              title={a.pinned ? "取消置顶" : "置顶"}
              className={cls(
                "absolute right-2 top-2 rounded-md p-1 transition-all",
                a.pinned
                  ? "text-brand opacity-100"
                  : "text-faint opacity-0 hover:bg-edge/60 hover:text-brand group-hover:opacity-100",
              )}
            >
              {a.pinned ? <PinOff size={12} /> : <Pin size={12} />}
            </button>
          </div>
        ))}

        {artifacts.length === 0 && (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center px-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-card border border-dashed border-edgeDark text-faint">
              <FolderOpen size={20} />
            </span>
            <p className="mt-3 text-[12.5px] leading-relaxed text-faint">
              对话中产生的图表、数据与证据
              <br />
              会出现在这里
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- 技能 tab ---------------- */

function SkillsTab() {
  const skills = useStore((s) => s.skills);
  return (
    <div className="h-full space-y-2 overflow-y-auto px-4 py-3.5">
      <p className="rounded-lg border border-jade/20 bg-jade-soft/50 px-3 py-2 text-[11.5px] leading-relaxed text-jade">
        这是 Agent 可调用的 {skills.length} 个数据技能（akshare 真实数据），可在对话中直接要求使用。
      </p>
      {skills.map((s) => {
        const props = (s.parameters as { properties?: Record<string, unknown> } | undefined)?.properties;
        const params = props ? Object.keys(props) : [];
        return (
          <div
            key={s.name}
            className="rounded-card border border-edge bg-card px-3.5 py-3 shadow-card transition-colors hover:border-jade/40"
          >
            <div className="flex items-center gap-2">
              <Wrench size={13} className="text-jade" />
              <span className="text-[13px] font-semibold text-ink">{skillCn(s.name)}</span>
              <span className="font-mono text-[10.5px] text-faint">{s.name}</span>
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-mute">{s.description}</p>
            {params.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {params.map((p) => (
                  <span key={p} className="rounded bg-[#F4F2EE] px-1.5 py-px font-mono text-[10.5px] text-mute">
                    {p}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {skills.length === 0 && <p className="py-8 text-center text-[12.5px] text-faint">技能清单加载失败或后端未启动</p>}
    </div>
  );
}

/* ---------------- 团队 tab ---------------- */

function TeamTab() {
  const agents = useStore((s) => s.agents);
  return (
    <div className="h-full space-y-2 overflow-y-auto px-4 py-3.5">
      <p className="rounded-lg border border-brand/20 bg-brand-soft/40 px-3 py-2 text-[11.5px] leading-relaxed text-brand">
        「深度研究团队」模式下，Planner 拆解任务，多个专家并行执行，复核员把关事实。
      </p>
      {agents.map((a) => (
        <div
          key={a.id}
          className="rounded-card border border-edge bg-card px-3.5 py-3 shadow-card transition-colors hover:border-edgeDark"
        >
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
              style={{ backgroundColor: a.avatar_color || "#6B6862" }}
            >
              {(a.name || a.id).slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-ink">{a.name}</p>
              <p className="font-mono text-[10.5px] text-faint">{a.id}</p>
            </div>
            <span
              className="rounded-full px-2 py-0.5 text-[10.5px] font-medium"
              style={{ color: a.avatar_color || "#6B6862", backgroundColor: `${a.avatar_color || "#6B6862"}14` }}
            >
              {a.skills?.length ? `${a.skills.length} 技能` : "无技能"}
            </span>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-mute">{a.description}</p>
          {a.skills?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {a.skills.map((sk) => (
                <span key={sk} className="rounded bg-[#F4F2EE] px-1.5 py-px text-[10.5px] text-mute">
                  {skillCn(sk)}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
      {agents.length === 0 && <p className="py-8 text-center text-[12.5px] text-faint">团队信息加载失败或后端未启动</p>}
    </div>
  );
}

/* ---------------- 面板主体 ---------------- */

const TABS = [
  { id: "artifacts" as const, label: "产出物", icon: <FolderOpen size={14} /> },
  { id: "skills" as const, label: "技能", icon: <Wrench size={14} /> },
  { id: "team" as const, label: "团队", icon: <Users size={14} /> },
  { id: "logic" as const, label: "逻辑库", icon: <Beaker size={14} /> },
];

export default function RightPanel() {
  const rightTab = useStore((s) => s.rightTab);
  const setRightTab = useStore((s) => s.setRightTab);
  const rightOpen = useStore((s) => s.rightOpen);
  const setRightOpen = useStore((s) => s.setRightOpen);
  const selectedArtifactId = useStore((s) => s.selectedArtifactId);
  const artifact = useStore((s) => s.artifacts.find((a) => a.id === s.selectedArtifactId));
  const artifactCount = useStore((s) => s.artifacts.length);
  const logicCount = useStore((s) => s.logicLibrary.length);
  const pendingLogicCount = useStore(
    (s) => s.logicLibrary.filter((x) => x.status === "pending").length,
  );

  // 折叠态：细栏
  if (!rightOpen) {
    return (
      <aside className="flex h-full w-11 shrink-0 flex-col items-center gap-1 border-l border-edge bg-[#F4F2EE] py-2">
        <button
          onClick={() => setRightOpen(true)}
          title="展开工作台面板"
          className="rounded-lg p-2 text-mute transition-colors hover:bg-card hover:text-ink"
        >
          <PanelRightOpen size={16} />
        </button>
        <div className="my-1 h-px w-6 bg-edge" />
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setRightTab(t.id)}
            title={t.label}
            className={cls(
              "relative rounded-lg p-2 transition-colors",
              rightTab === t.id ? "bg-card text-jade shadow-card" : "text-mute hover:bg-card hover:text-ink",
            )}
          >
            {t.icon}
            {t.id === "artifacts" && artifactCount > 0 && (
              <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-brand" />
            )}
            {t.id === "logic" && pendingLogicCount > 0 && (
              <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-brand px-1 text-[9px] font-semibold text-card">
                {pendingLogicCount}
              </span>
            )}
          </button>
        ))}
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-[400px] shrink-0 flex-col border-l border-edge bg-[#FBFAF8]">
      {/* tab 头 */}
      <div className="flex items-center gap-1 border-b border-edge px-3 py-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setRightTab(t.id)}
            className={cls(
              "relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors",
              rightTab === t.id ? "bg-card text-ink shadow-card border border-edge" : "text-mute hover:text-ink",
            )}
          >
            {t.icon}
            {t.label}
            {t.id === "artifacts" && artifactCount > 0 && (
              <span className="rounded-full bg-brand-soft px-1.5 text-[10.5px] font-semibold text-brand">
                {artifactCount}
              </span>
            )}
            {t.id === "logic" && logicCount > 0 && (
              <span
                className={cls(
                  "rounded-full px-1.5 text-[10.5px] font-semibold",
                  pendingLogicCount > 0 ? "bg-brand text-card" : "bg-[#F4F2EE] text-faint",
                )}
              >
                {pendingLogicCount > 0 ? `${pendingLogicCount}/${logicCount}` : logicCount}
              </span>
            )}
          </button>
        ))}
        <button
          onClick={() => setRightOpen(false)}
          title="折叠面板"
          className="ml-auto rounded-lg p-1.5 text-faint transition-colors hover:bg-card hover:text-ink"
        >
          <PanelRightClose size={15} />
        </button>
      </div>

      {/* 内容 */}
      <div className="min-h-0 flex-1">
        {rightTab === "artifacts" &&
          (artifact && selectedArtifactId ? <ArtifactDetail artifact={artifact} /> : <ArtifactList />)}
        {rightTab === "skills" && <SkillsTab />}
        {rightTab === "team" && <TeamTab />}
        {rightTab === "logic" && <LogicLibraryTab />}
      </div>
    </aside>
  );
}
