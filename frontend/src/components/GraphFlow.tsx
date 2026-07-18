import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { GraphChart } from "echarts/charts";
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  GraphChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

const EDGE = "#E8E5E0";
const MUTE = "#6B6862";
const CARD = "#FFFFFF";
const FAINT = "#9C988F";

/** echarts 分类色（按 kind + claim status） */
const NODE_COLOR: Record<string, string> = {
  // evidence
  evidence: "#0F766E",          // 青
  // claim by status
  verified: "#2E9E5B",          // 绿
  rejected: "#D14343",          // 红
  needs_more: "#D08B1A",        // 橙
  insufficient: "#C25450",      // 暗红
  exploring: "#3D6B9E",         // 蓝
  // missing
  missing: "#B45309",           // 琥珀
};

const EDGE_COLOR: Record<string, string> = {
  supports: "#2E9E5B",
  contradicts: "#D14343",
  context: "#9C988F",
  addresses: "#3D6B9E",
};

const EDGE_LABEL: Record<string, string> = {
  supports: "支持",
  contradicts: "反驳",
  context: "上下文",
  addresses: "对应",
};

const KIND_LABEL: Record<string, string> = {
  evidence: "证据",
  claim: "推论",
  missing: "缺口",
};

/** 节点：按 kind 分类（category 字段），并按 status 着色（itemStyle.color） */
function buildOption(payload: any) {
  const nodes: any[] = (payload?.nodes || []).map((n: any) => {
    const kind = n.kind || "evidence";
    // claim 用 status 当主色，其它按 kind
    const colorKey = kind === "claim" ? (n.status || "exploring") : kind;
    return {
      id: n.id,
      name: n.id,
      // category 用于图例分组
      category: kind,
      // itemStyle.color 控制节点填充
      itemStyle: { color: NODE_COLOR[colorKey] || NODE_COLOR[kind] || "#6B6862" },
      // symbolSize：claim 按 confidence 缩放，evidence/missing 固定
      symbolSize: kind === "claim" ? 28 + (n.confidence || 0.5) * 18 : 30,
      // label：默认显示 ID
      label: {
        show: true,
        position: "inside",
        color: "#FFFFFF",
        fontSize: 10,
        fontWeight: 600,
        formatter: "{b}",
      },
      // tooltip 自定义
      _title: n.title,
      _body: n.body,
      _kind: kind,
      _status: n.status,
      _confidence: n.confidence,
      _sourceRef: n.source_ref,
    };
  });

  const links: any[] = (payload?.edges || []).map((e: any) => ({
    source: e.src,
    target: e.dst,
    lineStyle: {
      color: EDGE_COLOR[e.relation] || MUTE,
      width: 1.4,
      curveness: 0.18,
      opacity: 0.85,
    },
    label: {
      show: true,
      formatter: EDGE_LABEL[e.relation] || e.relation,
      fontSize: 9,
      color: EDGE_COLOR[e.relation] || MUTE,
      backgroundColor: "rgba(255,255,255,0.85)",
      padding: [1, 3],
      borderRadius: 3,
    },
    // echarts 关系图需要 symbol: ['none', 'arrow'] 显示箭头
    symbol: ["none", "arrow"],
    symbolSize: 6,
  }));

  // 补全缺失节点（如果某个 edge 的 src/dst 不在 nodes 里，echarts 会静默丢弃，
  // 这里给它们造一个隐形占位节点以保持图完整）
  const known = new Set(nodes.map((n) => n.id));
  for (const e of payload?.edges || []) {
    for (const x of [e.src, e.dst]) {
      if (!known.has(x)) {
        nodes.push({ id: x, name: x, category: "missing", itemStyle: { color: "#C9C4B9" }, symbolSize: 18, _title: "(未知节点)", _body: "", _kind: "missing" });
        known.add(x);
      }
    }
  }

  return {
    animationDurationUpdate: 600,
    animationEasingUpdate: "cubicOut",
    color: [NODE_COLOR.evidence, NODE_COLOR.exploring, NODE_COLOR.missing],
    textStyle: { fontFamily: "inherit" },
    tooltip: {
      trigger: "item",
      backgroundColor: CARD,
      borderColor: EDGE,
      textStyle: { color: "#1C1B1A", fontSize: 12 },
      extraCssText: "box-shadow: 0 2px 12px rgba(0,0,0,0.08); border-radius: 8px; max-width: 320px;",
      formatter: (params: any) => {
        if (params.dataType === "edge") {
          return `<div style="font-weight:600;color:${EDGE_COLOR[params.data?.lineStyle?.color] || MUTE}">${params.data?.label?.formatter || "关系"}</div>`;
        }
        const d = params.data || {};
        const status = d._status ? ` · <span style="color:${NODE_COLOR[d._status] || MUTE}">${d._status}</span>` : "";
        const conf = d._confidence != null ? ` · 置信度 ${Number(d._confidence).toFixed(2)}` : "";
        const body = d._body ? `<div style="margin-top:4px;color:${MUTE};max-width:280px;line-height:1.5">${escapeHtml(String(d._body)).slice(0, 280)}${String(d._body).length > 280 ? "…" : ""}</div>` : "";
        const src = d._sourceRef ? `<div style="margin-top:4px;font-family:monospace;font-size:10.5px;color:${FAINT}">src: ${escapeHtml(String(d._sourceRef)).slice(0, 80)}</div>` : "";
        return `
          <div style="font-weight:600;color:#1C1B1A">${KIND_LABEL[d._kind] || d._kind} · ${escapeHtml(String(d._title || d.id))}</div>
          <div style="margin-top:2px;font-size:11px;color:${MUTE}">${d.id}${status}${conf}</div>
          ${body}
          ${src}
        `;
      },
    },
    legend: {
      data: [
        { name: "evidence", label: "证据", itemStyle: { color: NODE_COLOR.evidence } },
        { name: "claim", label: "推论", itemStyle: { color: NODE_COLOR.exploring } },
        { name: "missing", label: "缺口", itemStyle: { color: NODE_COLOR.missing } },
      ],
      top: 4,
      left: "center",
      textStyle: { color: MUTE, fontSize: 11 },
      itemWidth: 10,
      itemHeight: 10,
    },
    series: [
      {
        type: "graph",
        layout: "force",
        roam: true,
        draggable: true,
        focusNodeAdjacency: true,
        categories: [
          { name: "evidence", itemStyle: { color: NODE_COLOR.evidence } },
          { name: "claim", itemStyle: { color: NODE_COLOR.exploring } },
          { name: "missing", itemStyle: { color: NODE_COLOR.missing } },
        ],
        data: nodes,
        links,
        force: {
          repulsion: 320,
          edgeLength: [60, 110],
          gravity: 0.08,
          friction: 0.18,
        },
        emphasis: {
          focus: "adjacency",
          lineStyle: { width: 2.5 },
          itemStyle: { borderColor: "#1C1B1A", borderWidth: 2 },
          label: { fontSize: 11, fontWeight: 700 },
        },
        lineStyle: { opacity: 0.85 },
        edgeSymbol: ["none", "arrow"],
        edgeSymbolSize: 6,
        cursor: "pointer",
      },
    ],
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 证据图力导向可视化：节点=evidence/claim/missing，边=supports/contradicts/context/addresses */
export default function GraphFlow({ payload, height = 420 }: { payload: any; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption(buildOption(payload));

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [payload]);

  return <div ref={ref} style={{ height }} className="w-full" />;
}
