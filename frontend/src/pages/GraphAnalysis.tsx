import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Cpu,
  Database,
  ExternalLink,
  Loader2,
  Orbit,
  Radar,
  ShieldAlert,
  Sparkles,
  Target,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useFeverStore, type Event } from '../store';
import {
  buildFallbackProcessedEventAnalysis,
  loadProcessedEventAnalysis,
  type ProcessedEventAnalysis,
} from '../services/eventAnalysis';
import {
  findRelatedEvents,
  getEventType,
  getHeatShift,
  getPriorityScore,
  getRelativeTimeLabel,
  getSignalQuality,
} from '../lib/eventIntel';

type GraphStatus = 'processing' | 'revealing' | 'ready' | 'error';

type ChainNodeData = {
  label: string;
  summary: string;
  kind: 'event' | 'factor' | 'transmission' | 'asset' | 'verify' | 'counter' | 'related';
  fever?: number;
  tone?: 'high' | 'medium' | 'low';
  href?: string;
  meta?: string;
  stats?: string[];
  stage: number;
};

type ChainEdge = Edge<{ stage: number }>;

type GraphBuildResult = {
  nodes: Node<ChainNodeData>[];
  edges: ChainEdge[];
  relatedEvents: Event[];
  assetNodes: string[];
};

const GRAPH_REVEAL_MAX_STAGE = 3;
const GRAPH_MIN_PROCESSING_MS = 1100;
const GRAPH_REVEAL_INTERVAL_MS = 520;
const GRAPH_PROCESSING_STEPS = [
  { label: '读取事件', detail: '载入事件快照与上下文。', icon: Database },
  { label: '抽取因子', detail: '整理驱动与关键变量。', icon: Cpu },
  { label: '构建链路', detail: '展开传导、资产和验证。', icon: Sparkles },
  { label: '准备展示', detail: '按层级逐步展开图谱。', icon: CheckCircle2 },
] as const;

function toneClass(tone: ChainNodeData['tone']) {
  if (tone === 'high') return 'border-fever-500/50 bg-fever-950/20 text-fever-300';
  if (tone === 'medium') return 'border-yellow-700/50 bg-yellow-950/20 text-yellow-200';
  return 'border-blue-800/50 bg-blue-950/20 text-blue-200';
}

function kindLabel(kind: ChainNodeData['kind']) {
  const labels = {
    event: '事件',
    factor: '因子',
    transmission: '传导',
    asset: '资产',
    verify: '验证',
    counter: '反证',
    related: '对照',
  } as const;
  return labels[kind];
}

function kindSurface(kind: ChainNodeData['kind']) {
  const surfaces = {
    event: 'border-white/70 bg-gray-950 text-white',
    factor: 'border-blue-800/60 bg-blue-950/20 text-blue-100',
    transmission: 'border-cyan-800/60 bg-cyan-950/20 text-cyan-100',
    asset: 'border-amber-700/60 bg-amber-950/20 text-amber-100',
    verify: 'border-violet-800/60 bg-violet-950/20 text-violet-100',
    counter: 'border-rose-800/60 bg-rose-950/20 text-rose-100',
    related: 'border-emerald-800/60 bg-emerald-950/20 text-emerald-100',
  } as const;
  return surfaces[kind];
}

function shortText(value: string, max = 88) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}...`;
}

function ChainNode({ data, selected }: { data: ChainNodeData; selected: boolean }) {
  const widthClass =
    data.kind === 'event' ? 'w-[320px]' : data.kind === 'asset' ? 'w-[220px]' : 'w-[240px]';

  return (
    <div
      className={clsx(
        'relative rounded-2xl border p-4 shadow-lg backdrop-blur-sm transition-all',
        widthClass,
        selected
          ? 'border-white bg-gray-900 shadow-white/10 scale-[1.02]'
          : clsx(kindSurface(data.kind), toneClass(data.tone)),
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-transparent !border-none !-ml-1" />
      <div className="flex items-start justify-between gap-3 mb-3">
        <span className="text-[10px] uppercase tracking-[0.18em] text-gray-500">{kindLabel(data.kind)}</span>
        {typeof data.fever === 'number' ? (
          <span className="text-[10px] text-gray-300">{data.fever.toFixed(0)}°</span>
        ) : null}
      </div>
      <div className="text-sm font-semibold text-gray-100 leading-snug">
        {shortText(data.label, data.kind === 'event' ? 76 : 42)}
      </div>
      <div className="text-xs text-gray-400 leading-relaxed mt-2">
        {shortText(data.summary, data.kind === 'event' ? 110 : 72)}
      </div>
      {data.meta ? (
        <div className="text-[10px] uppercase tracking-widest text-gray-500 mt-3">{data.meta}</div>
      ) : null}
      {data.stats && data.stats.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {data.stats.slice(0, 2).map((stat) => (
            <span
              key={stat}
              className="text-[10px] px-1.5 py-0.5 rounded border border-gray-700/80 bg-gray-950/80 text-gray-300"
            >
              {stat}
            </span>
          ))}
        </div>
      ) : null}
      {data.href ? <div className="text-[10px] text-blue-300 mt-3">可跳转源头</div> : null}
      <div
        className={clsx(
          'absolute -top-2 -right-2 rounded border px-1.5 py-0.5 text-[9px]',
          selected ? 'border-white text-white bg-gray-950' : 'border-gray-700 text-gray-400 bg-gray-950',
        )}
      >
        {kindLabel(data.kind)}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-transparent !border-none !-mr-1" />
    </div>
  );
}

const nodeTypes = {
  chain: ChainNode,
};

function resolveActiveEvent(
  activeSessionId: string | null,
  sessions: ReturnType<typeof useFeverStore.getState>['sessions'],
  events: Event[],
  activeMarket: 'Global' | 'US' | 'EU' | 'Asia',
  targetAssets: string[],
) {
  const activeSession = sessions.find((session) => session.id === activeSessionId) || sessions[0];

  if (activeSession?.sourceEventId) {
    const matched = events.find((event) => event.id === activeSession.sourceEventId);
    if (matched) return { activeSession, activeEvent: matched };
  }

  if (activeSession?.id?.startsWith('s-') && activeSession.id !== 's-default') {
    const matched = events.find((event) => event.id === activeSession.id.slice(2));
    if (matched) return { activeSession, activeEvent: matched };
  }

  const rankedCandidates = [...events]
    .filter((event) => activeMarket === 'Global' || event.market === activeMarket || event.market === 'Global')
    .sort((a, b) => getPriorityScore(b, targetAssets) - getPriorityScore(a, targetAssets));

  return { activeSession, activeEvent: rankedCandidates[0] || events[0] };
}

function buildGraphData(
  activeEvent: Event,
  analysis: ProcessedEventAnalysis,
  events: Event[],
  targetAssets: string[],
): GraphBuildResult {
  const relatedEvents = findRelatedEvents(events, activeEvent).slice(0, 2);
  const signal = getSignalQuality(activeEvent);
  const eventType = getEventType(activeEvent);
  const assetFocus = [
    ...new Set([...activeEvent.impactAssets, ...analysis.impactMatrix.map((item) => item.label)]),
  ].slice(0, 5);
  const followedSet = new Set(targetAssets.map((asset) => asset.toUpperCase()));

  const nodes: Node<ChainNodeData>[] = [
    {
      id: `event-${activeEvent.id}`,
      type: 'chain',
      position: { x: 420, y: 280 },
      data: {
        label: activeEvent.title,
        summary: analysis.heroSummary,
        kind: 'event',
        fever: activeEvent.feverLevel,
        tone: signal.tone,
        href: activeEvent.sourceUrl,
        meta: `${activeEvent.market} · ${eventType.label}`,
        stats: [signal.label, getRelativeTimeLabel(activeEvent.timestamp)],
        stage: 0,
      },
    },
  ];

  const edges: ChainEdge[] = [];

  analysis.factorCards.slice(0, 3).forEach((factor, index) => {
    const factorId = `factor-${index}`;
    nodes.push({
      id: factorId,
      type: 'chain',
      position: { x: 70, y: 70 + index * 175 },
      data: {
        label: factor.title,
        summary: factor.detail,
        kind: 'factor',
        tone: factor.tone,
        meta: factor.direction,
        stats: factor.metrics.slice(0, 2).map((metric) => `${metric.label} ${metric.value}`),
        stage: 0,
      },
    });
    edges.push({
      id: `edge-event-factor-${index}`,
      source: factorId,
      target: `event-${activeEvent.id}`,
      label: '驱动',
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b' },
      style: { stroke: '#64748b', strokeWidth: 1.5 },
      data: { stage: 0 },
    });
  });

  analysis.transmissionRows.slice(0, 3).forEach((row, index) => {
    const transmissionId = `transmission-${index}`;
    nodes.push({
      id: transmissionId,
      type: 'chain',
      position: { x: 760, y: 70 + index * 175 },
      data: {
        label: row.event,
        summary: row.mechanism,
        kind: 'transmission',
        tone: index === 0 ? signal.tone : 'medium',
        meta: row.chainPosition,
        stats: [row.verify],
        stage: 1,
      },
    });
    edges.push({
      id: `edge-event-transmission-${index}`,
      source: index === 0 ? `event-${activeEvent.id}` : `transmission-${index - 1}`,
      target: transmissionId,
      label: index === 0 ? '起点' : '扩散',
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#38bdf8' },
      style: { stroke: '#38bdf8', strokeWidth: 2 },
      data: { stage: 1 },
    });
  });

  assetFocus.forEach((asset, index) => {
    const impact =
      analysis.impactMatrix.find((item) => item.label === asset) ||
      analysis.impactMatrix[index % Math.max(analysis.impactMatrix.length, 1)];
    const assetId = `asset-${index}`;
    const isFollowed = followedSet.has(asset.toUpperCase());
    nodes.push({
      id: assetId,
      type: 'chain',
      position: { x: 1120, y: 40 + index * 145 },
      data: {
        label: asset,
        summary: impact?.detail || `${asset} 对当前事件较敏感，关注量价与资金反馈。`,
        kind: 'asset',
        tone: isFollowed ? 'high' : impact?.tone || 'medium',
        meta: isFollowed ? '关注标的' : '影响资产',
        stats: isFollowed ? ['已关注'] : undefined,
        stage: 2,
      },
    });
    edges.push({
      id: `edge-transmission-asset-${index}`,
      source: `transmission-${Math.min(index, Math.max(analysis.transmissionRows.length - 1, 0))}`,
      target: assetId,
      label: '影响',
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' },
      style: { stroke: '#f59e0b', strokeWidth: 1.8 },
      data: { stage: 2 },
    });
  });

  analysis.watchPoints.slice(0, 3).forEach((point, index) => {
    const verifyId = `verify-${index}`;
    nodes.push({
      id: verifyId,
      type: 'chain',
      position: { x: 430, y: 620 + index * 120 },
      data: {
        label: `验证点 ${index + 1}`,
        summary: point,
        kind: 'verify',
        tone: 'low',
        stats: ['待确认'],
        stage: 3,
      },
    });
    edges.push({
      id: `edge-transmission-verify-${index}`,
      source: `transmission-${Math.min(index, Math.max(analysis.transmissionRows.length - 1, 0))}`,
      target: verifyId,
      label: '验证',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#a78bfa' },
      style: { stroke: '#a78bfa', strokeWidth: 1.4, strokeDasharray: '6 4' },
      data: { stage: 3 },
    });
  });

  analysis.counterSignals.slice(0, 2).forEach((counter, index) => {
    const counterId = `counter-${index}`;
    nodes.push({
      id: counterId,
      type: 'chain',
      position: { x: 830, y: 650 + index * 135 },
      data: {
        label: `反证 ${index + 1}`,
        summary: counter,
        kind: 'counter',
        tone: 'high',
        stats: ['反向观察'],
        stage: 3,
      },
    });
    edges.push({
      id: `edge-counter-event-${index}`,
      source: counterId,
      target: `event-${activeEvent.id}`,
      label: '反证',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#fb7185' },
      style: { stroke: '#fb7185', strokeWidth: 1.5, strokeDasharray: '5 4' },
      data: { stage: 3 },
    });
  });

  relatedEvents.forEach((relatedEvent, index) => {
    const relatedId = `related-${relatedEvent.id}`;
    nodes.push({
      id: relatedId,
      type: 'chain',
      position: { x: 80, y: 640 + index * 135 },
      data: {
        label: relatedEvent.title,
        summary: relatedEvent.description,
        kind: 'related',
        fever: relatedEvent.feverLevel,
        tone: getSignalQuality(relatedEvent).tone,
        href: relatedEvent.sourceUrl,
        meta: `${relatedEvent.market} · ${getRelativeTimeLabel(relatedEvent.timestamp)}`,
        stats: [getEventType(relatedEvent).label],
        stage: 3,
      },
    });
    edges.push({
      id: `edge-event-related-${index}`,
      source: relatedId,
      target: `event-${activeEvent.id}`,
      label: '参照',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#34d399' },
      style: { stroke: '#34d399', strokeWidth: 1.4, strokeDasharray: '4 4' },
      data: { stage: 3 },
    });
  });

  return { nodes, edges, relatedEvents, assetNodes: assetFocus };
}

export default function GraphAnalysis() {
  const {
    sessions,
    events,
    activeSessionId,
    setActiveSession,
    createSessionFromEvent,
    selectedNodeId,
    setSelectedNodeId,
    activeMarket,
    targetAssets,
  } = useFeverStore();

  const { activeEvent } = useMemo(
    () => resolveActiveEvent(activeSessionId, sessions, events, activeMarket, targetAssets),
    [activeSessionId, sessions, events, activeMarket, targetAssets],
  );

  const fallbackAnalysis = useMemo(
    () => (activeEvent ? buildFallbackProcessedEventAnalysis(activeEvent, targetAssets) : null),
    [activeEvent, targetAssets],
  );
  const [processedAnalysis, setProcessedAnalysis] = useState<ProcessedEventAnalysis | null>(fallbackAnalysis);
  const [graphStatus, setGraphStatus] = useState<GraphStatus>('processing');
  const [analysisSource, setAnalysisSource] = useState<'cache' | 'generated' | 'fallback'>('fallback');
  const [graphError, setGraphError] = useState<string | null>(null);
  const [processingStageIndex, setProcessingStageIndex] = useState(0);
  const [revealStage, setRevealStage] = useState(-1);

  useEffect(() => {
    if (!activeEvent || !fallbackAnalysis) {
      setProcessedAnalysis(null);
      setGraphStatus('error');
      setAnalysisSource('fallback');
      setGraphError('当前没有可用事件');
      setProcessingStageIndex(0);
      setRevealStage(-1);
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();
    const pendingTimers: number[] = [];
    setProcessedAnalysis(fallbackAnalysis);
    setGraphStatus('processing');
    setAnalysisSource('fallback');
    setGraphError(null);
    setProcessingStageIndex(0);
    setRevealStage(-1);

    const timer = window.setInterval(() => {
      setProcessingStageIndex((prev) => (prev + 1) % GRAPH_PROCESSING_STEPS.length);
    }, 900);

    loadProcessedEventAnalysis(activeEvent, targetAssets)
      .then((result) => {
        const remaining = Math.max(GRAPH_MIN_PROCESSING_MS - (Date.now() - startedAt), 0);
        const revealTimer = window.setTimeout(() => {
          if (cancelled) return;
          setProcessedAnalysis(result.analysis);
          setAnalysisSource(result.source);
          setGraphStatus('revealing');
          setProcessingStageIndex(GRAPH_PROCESSING_STEPS.length - 1);
          setRevealStage(0);
        }, remaining);
        pendingTimers.push(revealTimer);
      })
      .catch((error) => {
        const remaining = Math.max(GRAPH_MIN_PROCESSING_MS - (Date.now() - startedAt), 0);
        const revealTimer = window.setTimeout(() => {
          if (cancelled) return;
          setProcessedAnalysis(fallbackAnalysis);
          setAnalysisSource('fallback');
          setGraphError(error instanceof Error ? error.message : '图谱处理失败');
          setGraphStatus('revealing');
          setProcessingStageIndex(GRAPH_PROCESSING_STEPS.length - 1);
          setRevealStage(0);
        }, remaining);
        pendingTimers.push(revealTimer);
      })
      .finally(() => {
        window.clearInterval(timer);
      });

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      pendingTimers.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, [activeEvent, targetAssets, fallbackAnalysis]);

  useEffect(() => {
    if (graphStatus !== 'revealing') return;

    if (revealStage >= GRAPH_REVEAL_MAX_STAGE) {
      setGraphStatus(graphError ? 'error' : 'ready');
      return;
    }

    const timer = window.setTimeout(() => {
      setRevealStage((prev) => Math.min(prev + 1, GRAPH_REVEAL_MAX_STAGE));
    }, GRAPH_REVEAL_INTERVAL_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [graphStatus, revealStage, analysisSource, graphError]);

  const displayAnalysis = processedAnalysis ?? fallbackAnalysis;

  const graphData = useMemo(
    () => (activeEvent && displayAnalysis ? buildGraphData(activeEvent, displayAnalysis, events, targetAssets) : null),
    [activeEvent, displayAnalysis, events, targetAssets],
  );

  const visibleNodes = useMemo(() => {
    if (!graphData) return [];
    if (graphStatus === 'processing') return [];
    return graphData.nodes.filter((node) => node.data.stage <= Math.max(revealStage, 0));
  }, [graphData, graphStatus, revealStage]);

  const visibleEdges = useMemo(() => {
    if (!graphData) return [];
    if (graphStatus === 'processing') return [];
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    return graphData.edges.filter(
      (edge) =>
        (edge.data?.stage ?? 0) <= Math.max(revealStage, 0) &&
        visibleIds.has(edge.source) &&
        visibleIds.has(edge.target),
    );
  }, [graphData, graphStatus, revealStage, visibleNodes]);

  useEffect(() => {
    if (!visibleNodes.length) {
      setSelectedNodeId(null);
      return;
    }

    if (!selectedNodeId || !visibleNodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(visibleNodes[0].id);
    }
  }, [visibleNodes, selectedNodeId, setSelectedNodeId]);

  const selectedNode = visibleNodes.find((node) => node.id === selectedNodeId);
  const selectedData = selectedNode?.data;

  if (!activeEvent || !fallbackAnalysis) {
    return (
      <div className="border border-gray-800 bg-[#0a0a0a] rounded-lg p-8">
        <div className="text-sm text-gray-400">当前没有可用事件，暂时无法生成事件图谱。</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-6">
      <div className="flex gap-2 w-full overflow-x-auto pb-2 custom-scrollbar px-1">
        {sessions.map((session) => (
          <button
            key={session.id}
            onClick={() => setActiveSession(session.id)}
            className={clsx(
              'px-4 py-2 text-xs border rounded-lg whitespace-nowrap transition-colors',
              activeSessionId === session.id
                ? 'border-gray-500 bg-gray-900 text-gray-100'
                : 'border-gray-800 bg-[#0a0a0a] text-gray-500 hover:border-gray-600 hover:text-gray-300',
            )}
          >
            {session.title && session.title.length > 24 ? `${session.title.slice(0, 24)}...` : session.title}
          </button>
        ))}
      </div>

      <div className="border border-gray-800 bg-[#0a0a0a] rounded-lg px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-2">事件图谱</div>
            <h2 className="text-lg font-semibold text-gray-100 leading-tight">{shortText(activeEvent.title, 72)}</h2>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-gray-500 mt-1.5">
              <Link to="/" className="hover:text-gray-300 transition-colors">
                信号总览
              </Link>
              <ArrowRight className="w-3 h-3" />
              <span>{activeEvent.market}</span>
              <ArrowRight className="w-3 h-3" />
              <span>{getEventType(activeEvent).label}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="text-[10px] px-2 py-1 rounded border border-gray-800 bg-gray-900 text-fever-400 uppercase tracking-wider">
              热度 {activeEvent.feverLevel.toFixed(0)}°
            </span>
            <span className="text-[10px] px-2 py-1 rounded border border-gray-800 bg-gray-900 text-gray-300 uppercase tracking-wider">
              偏移 {getHeatShift(activeEvent) >= 0 ? '+' : ''}
              {getHeatShift(activeEvent).toFixed(1)}°
            </span>
            <span className="text-[10px] px-2 py-1 rounded border border-gray-800 bg-gray-900 text-gray-300 uppercase tracking-wider">
              {analysisSource === 'cache'
                ? '缓存'
                : analysisSource === 'generated'
                  ? '生成'
                  : '回退'}
            </span>
            <span className="text-[10px] px-2 py-1 rounded border border-gray-800 bg-gray-900 text-gray-300 uppercase tracking-wider">
              {getRelativeTimeLabel(activeEvent.timestamp)}
            </span>
          </div>
        </div>
      </div>

      <div className="border border-gray-800 bg-[#0a0a0a] rounded-lg overflow-hidden">
        <div className="relative w-full" style={{ height: 'calc(100vh - 220px)', minHeight: 860 }}>
          <ReactFlow
            nodes={visibleNodes}
            edges={visibleEdges}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            className="bg-[#050505]"
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#1f2937" gap={20} size={1} />
            <Controls className="!bg-gray-900 !border-gray-700 !fill-gray-300" />
            <MiniMap
              nodeColor={(node) => {
                const kind = node.data?.kind;
                if (kind === 'event') return '#ffffff';
                if (kind === 'factor') return '#60a5fa';
                if (kind === 'transmission') return '#22d3ee';
                if (kind === 'asset') return '#f59e0b';
                if (kind === 'verify') return '#a78bfa';
                if (kind === 'counter') return '#fb7185';
                return '#34d399';
              }}
              maskColor="rgba(0,0,0,0.78)"
              className="!bg-gray-950 !border-gray-800"
            />

            <Panel position="top-left">
              <div className="rounded-xl border border-gray-800 bg-black/80 backdrop-blur px-3 py-2">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-gray-500">
                  <Orbit className="w-3.5 h-3.5" />
                  图例
                </div>
                <div className="flex flex-wrap gap-2 mt-2 max-w-[360px]">
                  {[
                    ['事件', 'border-white'],
                    ['因子', 'border-blue-700'],
                    ['传导', 'border-cyan-700'],
                    ['资产', 'border-amber-700'],
                    ['验证', 'border-violet-700'],
                    ['反证', 'border-rose-700'],
                    ['对照', 'border-emerald-700'],
                  ].map(([label, border]) => (
                    <span
                      key={label}
                      className={clsx('text-[10px] px-2 py-1 rounded border bg-gray-950 text-gray-300', border)}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            </Panel>

            <Panel position="top-right">
              <div className="w-[300px] rounded-2xl border border-gray-800 bg-black/82 backdrop-blur p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">
                      {selectedData ? kindLabel(selectedData.kind) : '节点'}
                    </div>
                    <div className="text-sm font-semibold text-gray-100 mt-2">
                      {selectedData ? selectedData.label : '等待展开'}
                    </div>
                  </div>
                  {selectedData?.href ? (
                    <a
                      href={selectedData.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-500 hover:text-blue-400 transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  ) : null}
                </div>
                <div className="text-xs text-gray-400 leading-relaxed mt-3">
                  {selectedData ? selectedData.summary : '图谱节点会按阶段逐步出现。'}
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {selectedData?.meta ? (
                    <span className="text-[10px] px-2 py-1 rounded border border-gray-800 bg-gray-950 text-gray-400">
                      {selectedData.meta}
                    </span>
                  ) : null}
                  {selectedData?.stats?.slice(0, 2).map((stat) => (
                    <span key={stat} className="text-[10px] px-2 py-1 rounded border border-gray-800 bg-gray-950 text-gray-400">
                      {stat}
                    </span>
                  ))}
                </div>
              </div>
            </Panel>

            <Panel position="bottom-left">
              <div className="w-[360px] rounded-xl border border-gray-800 bg-black/78 backdrop-blur p-3">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-gray-500">
                  <Target className="w-3.5 h-3.5" />
                  图谱内容
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {[
                    '事件中心',
                    '驱动因子',
                    '传导链',
                    '影响资产',
                    '验证点',
                    '反证',
                    '对照事件',
                  ].map((item) => (
                    <span key={item} className="text-[10px] px-2 py-1 rounded border border-gray-800 bg-gray-950 text-gray-300">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </Panel>

            <Panel position="bottom-center">
              <div className="w-[420px] rounded-xl border border-gray-800 bg-black/78 backdrop-blur p-3">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-gray-500">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  快速跳转
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {graphData?.relatedEvents.length ? (
                    graphData.relatedEvents.map((event) => (
                      <button
                        key={event.id}
                        onClick={() => createSessionFromEvent(event)}
                        className="text-[10px] px-2 py-1 rounded border border-gray-800 bg-gray-950 text-gray-300 hover:border-gray-600 transition-colors"
                      >
                        {shortText(event.title, 22)}
                      </button>
                    ))
                  ) : (
                    <span className="text-[10px] text-gray-500">暂无对照事件</span>
                  )}
                </div>
              </div>
            </Panel>

            <Panel position="bottom-right">
              <div className="w-[280px] rounded-xl border border-gray-800 bg-black/78 backdrop-blur p-3">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-gray-500">
                  <Radar className="w-3.5 h-3.5" />
                  边界
                </div>
                <div className="text-xs text-gray-400 leading-relaxed mt-2">
                  {displayAnalysis?.evidenceBoundary}
                </div>
              </div>
            </Panel>
          </ReactFlow>

          {graphStatus === 'processing' ? (
            <div className="absolute inset-0 bg-black/78 backdrop-blur-sm flex items-center justify-center z-20">
              <div className="w-full max-w-2xl px-6">
                <div className="border border-gray-800 bg-[#080808] rounded-2xl p-6">
                  <div className="flex items-center gap-3 mb-5">
                    <Loader2 className="w-5 h-5 text-gray-300 animate-spin" />
                    <div>
                      <div className="text-sm font-semibold text-gray-100">事件图谱处理中</div>
                      <div className="text-xs text-gray-500 mt-1">先抽取事件链路，再按层级展开图谱。</div>
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-4">
                    {GRAPH_PROCESSING_STEPS.map((step, index) => {
                      const Icon = step.icon;
                      const isActive = index === processingStageIndex;
                      const isCompleted = index < processingStageIndex;
                      return (
                        <div
                          key={step.label}
                          className={clsx(
                            'rounded-xl border p-4 transition-colors',
                            isActive
                              ? 'border-gray-500 bg-gray-900'
                              : isCompleted
                                ? 'border-gray-700 bg-gray-950'
                                : 'border-gray-800 bg-[#050505]',
                          )}
                        >
                          <div className="flex items-center gap-2 mb-3">
                            <Icon className={clsx('w-4 h-4', isActive ? 'text-white' : 'text-gray-500')} />
                            <div className="text-xs font-semibold text-gray-200">{step.label}</div>
                          </div>
                          <div className="text-xs text-gray-500 leading-relaxed">{step.detail}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {graphStatus === 'revealing' ? (
            <div className="absolute left-1/2 top-6 -translate-x-1/2 z-20">
              <div className="rounded-full border border-gray-800 bg-black/78 backdrop-blur px-4 py-2">
                <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500 mb-1">图谱展开中</div>
                <div className="flex items-center gap-2">
                  {['事件与因子', '传导链', '资产', '验证与对照'].map((label, index) => (
                    <div key={label} className="flex items-center gap-2">
                      <div
                        className={clsx(
                          'h-1.5 w-10 rounded-full',
                          index <= revealStage ? 'bg-white' : 'bg-gray-800',
                        )}
                      />
                      <span className={clsx('text-[10px]', index <= revealStage ? 'text-gray-200' : 'text-gray-500')}>
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {graphStatus === 'error' && graphError ? (
            <div className="absolute left-1/2 bottom-6 -translate-x-1/2 z-20">
              <div className="rounded-full border border-rose-900 bg-rose-950/30 backdrop-blur px-4 py-2 text-xs text-rose-200">
                图谱处理失败，已回退到规则链路。
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
