import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { LinePayload } from "../types";

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, CanvasRenderer]);

const MUTE = "#6B6862";
const EDGE = "#E8E5E0";
/** 暖纸系折线配色：琥珀 / 青 / 赭 / 红 / 绿 / 灰蓝 */
const PALETTE = ["#B45309", "#0F766E", "#7C5C3E", "#D14343", "#2E9E5B", "#4A5D6B"];

/** 通用折线图：CAR 曲线 / 指数 / 宏观指标（design.md §9 line） */
export default function CarChart({ payload, height = 360 }: { payload: LinePayload; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const { x = [], series = [], yname } = payload;

    chart.setOption({
      animation: false,
      color: PALETTE,
      textStyle: { fontFamily: "inherit" },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#FFFFFF",
        borderColor: EDGE,
        textStyle: { color: "#1C1B1A", fontSize: 12 },
        valueFormatter: (v: unknown) =>
          typeof v === "number" ? (Math.abs(v) < 10 ? v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : v.toFixed(2)) : String(v ?? "-"),
      },
      legend: series.length > 1
        ? { top: 0, textStyle: { color: MUTE, fontSize: 11 }, itemWidth: 14, itemHeight: 8 }
        : undefined,
      grid: { left: 52, right: 20, top: series.length > 1 ? 34 : 22, bottom: 46 },
      xAxis: {
        type: "category",
        data: x,
        boundaryGap: false,
        axisLine: { lineStyle: { color: EDGE } },
        axisTick: { show: false },
        axisLabel: { color: MUTE, fontSize: 10, interval: Math.max(0, Math.floor(x.length / 8)) },
      },
      yAxis: {
        type: "value",
        name: yname,
        nameTextStyle: { color: MUTE, fontSize: 10 },
        scale: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: MUTE, fontSize: 11 },
        splitLine: { lineStyle: { color: "#F0EDE8" } },
      },
      dataZoom: [
        { type: "inside", start: 0, end: 100 },
        {
          type: "slider",
          bottom: 6,
          height: 16,
          borderColor: EDGE,
          backgroundColor: "#FAF9F7",
          fillerColor: "rgba(15, 118, 110, 0.08)",
          handleStyle: { color: "#0F766E" },
          moveHandleStyle: { color: "#0F766E" },
          textStyle: { color: MUTE, fontSize: 10 },
          dataBackground: { lineStyle: { color: "#D8D4CC" }, areaStyle: { color: "#F0EDE8" } },
        },
      ],
      series: series.map((s, i) => ({
        name: s.name,
        type: "line" as const,
        data: s.data,
        showSymbol: false,
        symbol: "circle",
        symbolSize: 5,
        smooth: false,
        lineStyle: { width: 2 },
        emphasis: { focus: "series" as const },
        areaStyle: i === 0 && series.length === 1 ? { opacity: 0.06 } : undefined,
        markLine:
          i === 0
            ? {
                symbol: "none",
                animation: false,
                silent: true,
                label: { show: false },
                lineStyle: { color: "#C9C4B9", type: "dashed" as const, width: 1 },
                data: [{ yAxis: 0 }],
              }
            : undefined,
      })),
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [payload]);

  return <div ref={ref} style={{ height }} className="w-full" />;
}
