import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, CandlestickChart } from "echarts/charts";
import {
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { KlinePayload } from "../types";

echarts.use([
  CandlestickChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  DataZoomComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

const RISE = "#D14343"; // 红涨
const FALL = "#2E9E5B"; // 绿跌
const INK = "#1C1B1A";
const MUTE = "#6B6862";
const EDGE = "#E8E5E0";

/** K线图：蜡烛图 + 成交量副图 + 事件日 markLine（design.md §9 kline） */
export default function KlineChart({ payload, height = 430 }: { payload: KlinePayload; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;

    const { dates = [], ohlc = [], volumes = [], event_date, symbol } = payload;
    const upDown = ohlc.map((d) => (d[1] >= d[0] ? 1 : -1));

    const markLine =
      event_date && dates.includes(event_date)
        ? {
            symbol: "none",
            animation: false,
            label: {
              formatter: "事件日",
              color: "#B45309",
              fontSize: 11,
              position: "insideEndTop" as const,
            },
            lineStyle: { color: "#B45309", type: "dashed" as const, width: 1.5 },
            data: [{ xAxis: event_date }],
          }
        : undefined;

    chart.setOption({
      animation: false,
      textStyle: { fontFamily: "inherit" },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross", lineStyle: { color: "#B9B4AA" } },
        backgroundColor: "#FFFFFF",
        borderColor: EDGE,
        textStyle: { color: INK, fontSize: 12 },
        formatter: (params: unknown) => {
          const arr = params as { seriesType?: string; dataIndex: number; axisValue?: string }[];
          const k = arr.find((p) => p.seriesType === "candlestick");
          if (!k) return String(arr[0]?.axisValue ?? "");
          const i = k.dataIndex;
          const d = ohlc[i];
          if (!d) return "";
          const chg = i > 0 ? ((d[1] - ohlc[i - 1][1]) / ohlc[i - 1][1]) * 100 : 0;
          const color = d[1] >= d[0] ? RISE : FALL;
          const row = (label: string, val: string) =>
            `<div style="display:flex;justify-content:space-between;gap:16px"><span style="color:${MUTE}">${label}</span><span style="font-weight:600">${val}</span></div>`;
          return `<div style="font-size:12px;min-width:150px">
            <div style="font-weight:700;margin-bottom:4px">${dates[i]}</div>
            ${row("开", d[0].toFixed(2))}
            ${row("收", `<span style="color:${color}">${d[1].toFixed(2)}</span>`)}
            ${row("高", d[3].toFixed(2))}
            ${row("低", d[2].toFixed(2))}
            ${row("涨跌幅", `<span style="color:${chg >= 0 ? RISE : FALL}">${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%</span>`)}
            ${row("成交量", `${(volumes[i] / 10000).toFixed(1)}万手`)}
          </div>`;
        },
      },
      grid: [
        { left: 56, right: 18, top: 30, height: "58%" },
        { left: 56, right: 18, top: "74%", height: "16%" },
      ],
      xAxis: [
        {
          type: "category",
          data: dates,
          gridIndex: 0,
          boundaryGap: true,
          axisLine: { lineStyle: { color: EDGE } },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
        },
        {
          type: "category",
          data: dates,
          gridIndex: 1,
          boundaryGap: true,
          axisLine: { lineStyle: { color: EDGE } },
          axisTick: { show: false },
          axisLabel: { color: MUTE, fontSize: 10, interval: Math.max(1, Math.floor(dates.length / 4)) },
          splitLine: { show: false },
        },
      ],
      yAxis: [
        {
          scale: true,
          gridIndex: 0,
          position: "left",
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: MUTE, fontSize: 11 },
          splitLine: { lineStyle: { color: "#F0EDE8" } },
        },
        {
          scale: true,
          gridIndex: 1,
          position: "left",
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: MUTE,
            fontSize: 10,
            formatter: (v: number) => (v >= 1e8 ? (v / 1e8).toFixed(1) + "亿" : (v / 1e4).toFixed(0) + "万"),
          },
          splitLine: { show: false },
        },
      ],
      dataZoom: [
        { type: "inside", xAxisIndex: [0, 1], start: Math.max(0, 100 - (120 / Math.max(dates.length, 1)) * 100), end: 100 },
        {
          type: "slider",
          xAxisIndex: [0, 1],
          bottom: 6,
          height: 16,
          borderColor: EDGE,
          backgroundColor: "#FAF9F7",
          fillerColor: "rgba(180, 83, 9, 0.08)",
          handleStyle: { color: "#B45309" },
          moveHandleStyle: { color: "#B45309" },
          textStyle: { color: MUTE, fontSize: 10 },
          dataBackground: {
            lineStyle: { color: "#D8D4CC" },
            areaStyle: { color: "#F0EDE8" },
          },
        },
      ],
      series: [
        {
          name: symbol ?? "K线",
          type: "candlestick",
          data: ohlc,
          xAxisIndex: 0,
          yAxisIndex: 0,
          itemStyle: {
            color: RISE,
            color0: FALL,
            borderColor: RISE,
            borderColor0: FALL,
          },
          markLine,
        },
        {
          name: "成交量",
          type: "bar",
          data: volumes.map((v, i) => ({
            value: v,
            itemStyle: { color: upDown[i] > 0 ? "rgba(209,67,67,0.55)" : "rgba(46,158,91,0.55)" },
          })),
          xAxisIndex: 1,
          yAxisIndex: 1,
          barMaxWidth: 8,
        },
      ],
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [payload]);

  return <div ref={ref} style={{ height }} className="w-full" />;
}
