import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleSlash,
  Cpu,
  Database,
  ExternalLink,
  GitMerge,
  Layers3,
  Loader2,
  Radar,
  ShieldAlert,
  Sparkles,
  Target,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useFeverStore } from '../store';
import {
  getEventType,
  findRelatedEvents,
  getFraming,
  getFreshness,
  getHeatShift,
  getMovementRead,
  getRelativeTimeLabel,
  getSignalQuality,
} from '../lib/eventIntel';
import { buildFallbackProcessedEventAnalysis, loadProcessedEventAnalysis } from '../services/eventAnalysis';

function toneClass(tone: 'high' | 'medium' | 'low') {
  if (tone === 'high') return 'text-red-400 border-red-900 bg-red-950/20';
  if (tone === 'medium') return 'text-yellow-400 border-yellow-900 bg-yellow-950/20';
  return 'text-blue-400 border-blue-900 bg-blue-950/20';
}

const EMPTY_ANALYSIS = {
  heroSummary: '当前事件快照尚未就绪。',
  evidenceBoundary: '当前没有可用事件对象，无法生成研究结论。',
  conclusionGrade: '不可用',
  sourceSummary: '暂无来源摘要。',
  similarEventsSummary: '暂无相似事件可供参考。',
  researchFit: [],
  factorCards: [],
  attributionRows: [],
  transmissionRows: [],
  impactMatrix: [],
  evidenceLedger: [],
  watchPoints: [],
  counterSignals: [],
};

export default function EventDetail() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { events, createSessionFromEvent, targetAssets } = useFeverStore();

  const event = useMemo(() => events.find((item) => item.id === eventId), [events, eventId]);

  useEffect(() => {
    if (event) {
      createSessionFromEvent(event);
    }
  }, [event, createSessionFromEvent]);

  const relatedEvents = useMemo(() => (event ? findRelatedEvents(events, event) : []), [event, events]);

  const sameMarketContext = useMemo(() => {
    if (!event) return [];

    return events
      .filter((item) => item.id !== event.id && item.market === event.market)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 4);
  }, [event, events]);

  const fallbackAnalysis = useMemo(
    () => (event ? buildFallbackProcessedEventAnalysis(event, targetAssets) : EMPTY_ANALYSIS),
    [event, targetAssets],
  );
  const [processedAnalysis, setProcessedAnalysis] = useState(fallbackAnalysis);
  const [analysisStatus, setAnalysisStatus] = useState<'processing' | 'ready' | 'error'>('processing');
  const [analysisSource, setAnalysisSource] = useState<'cache' | 'generated' | 'fallback'>('fallback');
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [processingStageIndex, setProcessingStageIndex] = useState(0);
  const sectionTabs = [
    { id: 'hero', label: '结论' },
    { id: 'factors', label: '因子' },
    { id: 'transmission', label: '传导' },
    { id: 'matrix', label: '矩阵' },
    { id: 'sources', label: '源头' },
    { id: 'evidence', label: '证据' },
  ];
  const processingSteps = [
    { label: '读取事件快照', detail: '载入原始事件、市场和资产上下文。', icon: Database },
    { label: '构建传导链', detail: '生成机制、受益/承压与验证变量。', icon: Cpu },
    { label: '归并证据边界', detail: '整理支持、反方与待验证项。', icon: Sparkles },
    { label: '写入缓存', detail: '把处理结果持久化，后续直接复用。', icon: CheckCircle2 },
  ];
  const displayAnalysis = processedAnalysis ?? fallbackAnalysis;
  const factorCards = displayAnalysis.factorCards;
  const attributionRows = displayAnalysis.attributionRows;
  const transmissionMatrix = displayAnalysis.transmissionRows;
  const impactMatrix = displayAnalysis.impactMatrix;
  const evidenceLedger = displayAnalysis.evidenceLedger;
  const watchPoints = displayAnalysis.watchPoints;
  const counterSignals = displayAnalysis.counterSignals;
  const researchFit = displayAnalysis.researchFit;

  useEffect(() => {
    if (!event) {
      setProcessedAnalysis(EMPTY_ANALYSIS);
      setAnalysisStatus('error');
      setAnalysisSource('fallback');
      setAnalysisError('未找到对应事件');
      setProcessingStageIndex(0);
      return;
    }

    let cancelled = false;
    setProcessedAnalysis(fallbackAnalysis);
    setAnalysisStatus('processing');
    setAnalysisSource('fallback');
    setAnalysisError(null);
    setProcessingStageIndex(0);

    const timer = window.setInterval(() => {
      setProcessingStageIndex((prev) => (prev + 1) % processingSteps.length);
    }, 1200);

    loadProcessedEventAnalysis(event, targetAssets)
      .then((result) => {
        if (cancelled) return;
        setProcessedAnalysis(result.analysis);
        setAnalysisSource(result.source);
        setAnalysisStatus('ready');
        setProcessingStageIndex(processingSteps.length - 1);
      })
      .catch((error) => {
        if (cancelled) return;
        setProcessedAnalysis(fallbackAnalysis);
        setAnalysisSource('fallback');
        setAnalysisStatus('error');
        setAnalysisError(error instanceof Error ? error.message : '事件深度处理失败');
      })
      .finally(() => {
        window.clearInterval(timer);
      });

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [event, targetAssets, fallbackAnalysis]);

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (!event) {
    return (
      <div className="glass-panel p-8 max-w-3xl">
        <div className="text-sm text-gray-400 mb-4">未找到对应事件。</div>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 border border-obsidian-600 text-gray-300 hover:border-cyber-blue hover:text-cyber-blue transition-colors"
        >
          返回信号总览
        </button>
      </div>
    );
  }

  const heatShift = getHeatShift(event);
  const framing = getFraming(event);
  const eventType = getEventType(event);
  const freshness = getFreshness(event);
  const signal = getSignalQuality(event);
  const targetMatches = event.impactAssets.filter((asset) => targetAssets.includes(asset));
  const sourceLabel = event.sourceUrl ? '原始公开来源' : '免费事件流来源';

  return (
    <div className="h-full flex flex-col gap-12">
      <div id="hero" className="pt-4 pb-8 border-b border-gray-800">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-6">
          <Link to="/" className="hover:text-gray-300 transition-colors">
            信号总览
          </Link>
          <ArrowRight className="w-3 h-3" />
          <span>{event.market}</span>
          <ArrowRight className="w-3 h-3" />
          <span className="text-gray-400">{framing}</span>
        </div>

        <div className="flex flex-wrap gap-2 mb-8">
          {sectionTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => scrollToSection(tab.id)}
              className="px-3 py-1.5 rounded-full border border-gray-800 bg-[#0a0a0a] text-[10px] uppercase tracking-[0.18em] text-gray-400 hover:text-gray-100 hover:border-gray-600 transition-colors"
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1.4fr)_320px]">
          <div>
            <div className="mb-4">
              {event.sourceUrl ? (
                <a
                  href={event.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors break-all"
                >
                  <ExternalLink className="w-4 h-4 shrink-0" />
                  <span className="text-3xl font-bold leading-tight">{event.title}</span>
                </a>
              ) : (
                <h1 className="text-3xl font-bold text-gray-100 leading-tight">{event.title}</h1>
              )}
            </div>

            <div className="flex flex-wrap gap-2 mb-6">
              <span className="text-[10px] px-2 py-1 rounded bg-gray-800 text-gray-300 uppercase tracking-wider">{event.market}</span>
              <span className={clsx('text-[10px] px-2 py-1 rounded border uppercase tracking-wider', toneClass(eventType.tone))}>
                {eventType.label}
              </span>
              <span className={clsx('text-[10px] px-2 py-1 rounded border uppercase tracking-wider', toneClass(signal.tone))}>
                {signal.label}
              </span>
              <span className={clsx('text-[10px] px-2 py-1 rounded border uppercase tracking-wider', toneClass(freshness.tone))}>
                {freshness.label}
              </span>
            </div>

            <div className="border border-gray-800 bg-[#0a0a0a] p-5 rounded-lg">
              <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-3 font-semibold">结论</div>
              <p className="text-sm text-gray-200 leading-relaxed">{displayAnalysis.heroSummary}</p>
              <p className="text-sm text-gray-400 leading-relaxed mt-3">{getMovementRead(event)}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {event.impactAssets.map((asset) => (
                  <span
                    key={asset}
                    className={clsx(
                      'text-[10px] px-2.5 py-1 rounded border uppercase tracking-wider',
                      targetMatches.includes(asset)
                        ? 'border-gray-500 bg-gray-800 text-gray-200'
                        : 'border-gray-800 bg-[#0f0f0f] text-gray-400'
                    )}
                  >
                    {asset}
                  </span>
                ))}
              </div>
              <div className="text-xs text-gray-500 leading-relaxed mt-4 pt-4 border-t border-gray-800">
                边界：{displayAnalysis.evidenceBoundary}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="border border-gray-800 bg-[#0a0a0a] p-5 rounded-lg">
              <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-4">概览</div>
              <div className="space-y-5">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">热度</div>
                  <div className="text-2xl font-semibold text-fever-500">{event.feverLevel.toFixed(0)}°</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">偏移</div>
                  <div className={clsx('text-xl font-semibold', heatShift >= 0 ? 'text-fever-400' : 'text-gray-300')}>
                    {heatShift >= 0 ? '+' : ''}
                    {heatShift.toFixed(1)}°
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">证据</div>
                  <div className="text-sm text-gray-200">{displayAnalysis.conclusionGrade}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">更新</div>
                  <div className="text-sm text-gray-300">{new Date(event.timestamp).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">状态</div>
                  <div className="text-sm text-gray-200">
                    {analysisStatus === 'processing'
                      ? '处理中'
                      : analysisSource === 'cache'
                        ? '已命中缓存'
                        : analysisSource === 'generated'
                          ? '新生成并已保存'
                          : '规则回退并已缓存'}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => navigate('/graph')}
                className="px-4 py-2 border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700 transition-colors flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wider rounded"
              >
                <GitMerge className="w-4 h-4" />
                图谱推演
              </button>
              <button
                onClick={() => navigate('/')}
                className="px-4 py-2 border border-gray-800 text-gray-400 hover:text-gray-200 transition-colors flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wider rounded"
              >
                <ArrowLeft className="w-4 h-4" />
                返回总览
              </button>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-4 gap-4 mt-8">
          <div className="border border-gray-800 bg-[#0a0a0a] p-4 rounded-lg">
            <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">事件类型</div>
            <div className="text-lg font-semibold text-gray-100">{eventType.label}</div>
            <div className="text-xs text-gray-500 mt-2">{eventType.detail}</div>
          </div>
          <div className="border border-gray-800 bg-[#0a0a0a] p-4 rounded-lg">
            <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">匹配</div>
            <div className="text-lg font-semibold text-gray-100">{targetMatches.length > 0 ? '直接命中' : '间接相关'}</div>
            <div className="text-xs text-gray-500 mt-2">{targetMatches.length > 0 ? targetMatches.join(' / ') : '未命中关注资产'}</div>
          </div>
          <div className="border border-gray-800 bg-[#0a0a0a] p-4 rounded-lg">
            <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">证据窗口</div>
            <div className="text-lg font-semibold text-gray-100">{getRelativeTimeLabel(event.timestamp)}</div>
            <div className="text-xs text-gray-500 mt-2">短窗口事件分析。</div>
          </div>
          <div className="border border-gray-800 bg-[#0a0a0a] p-4 rounded-lg">
            <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">处理结果</div>
            <div className="text-lg font-semibold text-gray-100">
              {analysisSource === 'cache' ? '缓存命中' : analysisSource === 'generated' ? '已生成' : '规则回退'}
            </div>
            <div className="text-xs text-gray-500 mt-2">{displayAnalysis.sourceSummary}</div>
          </div>
        </div>
      </div>

      {analysisStatus === 'processing' ? (
        <section className="border border-gray-800 bg-[#0a0a0a] rounded-lg p-6">
          <div className="flex items-start gap-4">
            <div className="relative mt-1">
              <Loader2 className="w-5 h-5 text-fever-400 animate-spin" />
              <div className="absolute inset-0 rounded-full bg-fever-500/20 animate-ping" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-gray-100">正在处理事件</div>
              <div className="text-sm text-gray-400 leading-relaxed mt-2">结果会自动缓存。</div>
            </div>
          </div>

          <div className="grid md:grid-cols-4 gap-4 mt-6">
            {processingSteps.map((step, index) => {
              const Icon = step.icon;
              const isActive = index === processingStageIndex;
              const isCompleted = index < processingStageIndex;
              return (
                <div
                  key={step.label}
                  className={clsx(
                    'border rounded-lg p-4 transition-colors',
                    isActive
                      ? 'border-fever-500/50 bg-fever-500/10'
                      : isCompleted
                        ? 'border-gray-700 bg-gray-900/60'
                        : 'border-gray-800 bg-gray-950/50'
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <Icon className={clsx('w-4 h-4', isActive ? 'text-fever-400' : isCompleted ? 'text-gray-200' : 'text-gray-500')} />
                    <div className="text-[10px] uppercase tracking-widest text-gray-500">
                      {isCompleted ? 'done' : isActive ? 'running' : 'queued'}
                    </div>
                  </div>
                  <div className="text-sm text-gray-200 mt-3">{step.label}</div>
                  <div className="text-xs text-gray-500 leading-relaxed mt-2">{step.detail}</div>
                </div>
              );
            })}
          </div>

          <div className="mt-6">
            <div className="w-full h-1.5 rounded-full bg-gray-900 overflow-hidden">
              <div
                className="h-full bg-fever-400 transition-all duration-500"
                style={{ width: `${((processingStageIndex + 1) / processingSteps.length) * 100}%` }}
              />
            </div>
          </div>
        </section>
      ) : null}

      {analysisStatus === 'error' && analysisError ? (
        <section className="border border-yellow-900/40 bg-yellow-950/10 rounded-lg p-4 text-sm text-yellow-100">
          处理失败，已切回基础分析。{analysisError}
        </section>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.9fr)] gap-12">
        <div className="flex flex-col gap-12">
          <section id="factors">
            <div className="flex items-start gap-3 mb-6">
              <Radar className="w-4 h-4 text-gray-400 mt-1" />
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">因子</h2>
              </div>
            </div>

            <div className="space-y-4">
              {factorCards.map((factor) => (
                <div key={factor.title} className="border border-gray-800 bg-[#0a0a0a] p-5 rounded-lg">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-gray-100">{factor.title}</div>
                      <div className={clsx('inline-flex mt-2 text-[10px] px-2 py-1 rounded border uppercase tracking-wider', toneClass(factor.tone))}>
                        {factor.direction}
                      </div>
                    </div>
                    <div className="text-[10px] uppercase tracking-widest text-gray-500">{factor.progressLabel}</div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4 mt-5">
                    {factor.metrics.map((metric) => (
                      <div key={metric.label} className="border-t border-gray-800 pt-3">
                        <div className="text-[10px] uppercase tracking-widest text-gray-500">{metric.label}</div>
                        <div className="text-sm text-gray-200 mt-2">{metric.value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4">
                    <div className="w-full h-1.5 rounded-full bg-gray-900 overflow-hidden">
                      <div className="h-full bg-gray-300" style={{ width: `${factor.progressValue}%` }} />
                    </div>
                  </div>

                  <div className="text-sm text-gray-400 leading-relaxed mt-4">{factor.detail}</div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-start gap-3 mb-6">
              <Sparkles className="w-4 h-4 text-gray-400 mt-1" />
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">归因</h2>
              </div>
            </div>

            <div className="grid xl:grid-cols-[minmax(0,1.3fr)_280px] gap-6">
              <div className="border border-gray-800 bg-[#0a0a0a] rounded-lg overflow-x-auto">
                <div className="min-w-[860px]">
                  <div className="grid grid-cols-[1.1fr_0.8fr_0.8fr_1.4fr_1.4fr] gap-3 px-4 py-3 text-[10px] uppercase tracking-widest text-gray-500 border-b border-gray-800">
                    <div>因子</div>
                    <div>方向</div>
                    <div>贡献</div>
                    <div>客观证据</div>
                    <div>解释</div>
                  </div>
                  {attributionRows.map((row) => (
                    <div key={row.factor} className="grid grid-cols-[1.1fr_0.8fr_0.8fr_1.4fr_1.4fr] gap-3 px-4 py-4 border-b last:border-b-0 border-gray-800 text-sm">
                      <div className="text-gray-200">{row.factor}</div>
                      <div className="text-gray-300">{row.direction}</div>
                      <div className={clsx(row.contribution.startsWith('-') ? 'text-green-400' : 'text-red-400')}>{row.contribution}</div>
                      <div className="text-gray-300">{row.evidence}</div>
                      <div className="text-gray-400 leading-relaxed">{row.note}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border border-gray-800 bg-[#0a0a0a] p-5 rounded-lg">
                <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-4">合成结果</div>
                <div className="text-3xl font-semibold text-gray-100 mb-2">{event.sourceUrl ? '67 / 100' : '54 / 100'}</div>
                <div className="text-sm text-gray-400 leading-relaxed">结论基于事件类型、热度偏移和受影响资产，仍待更多证据确认。</div>
                <div className="mt-5 space-y-3">
                  {attributionRows.map((row) => (
                    <div key={row.factor} className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-gray-500">
                        <span>{row.factor}</span>
                        <span>{row.contribution}</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-gray-900 overflow-hidden">
                        <div
                          className={clsx('h-full', row.contribution.startsWith('-') ? 'bg-green-400' : 'bg-red-400')}
                          style={{ width: `${Math.min(100, Math.max(18, Number.parseInt(row.contribution.replace('+', ''), 10) * 3))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section id="transmission">
            <div className="flex items-start gap-3 mb-6">
              <Layers3 className="w-4 h-4 text-gray-400 mt-1" />
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">传导</h2>
              </div>
            </div>

            <div className="border border-gray-800 bg-[#0a0a0a] rounded-lg overflow-x-auto">
              <div className="min-w-[860px]">
                <div className="grid grid-cols-[1.2fr_1.4fr_0.8fr_1fr_1.3fr] gap-3 px-4 py-3 text-[10px] uppercase tracking-widest text-gray-500 border-b border-gray-800">
                  <div>事件</div>
                  <div>机制</div>
                  <div>位置</div>
                  <div>受益/承压</div>
                  <div>验证变量</div>
                </div>
                {transmissionMatrix.map((row) => (
                  <div key={`${row.event}-${row.chainPosition}`} className="grid grid-cols-[1.2fr_1.4fr_0.8fr_1fr_1.3fr] gap-3 px-4 py-4 border-b last:border-b-0 border-gray-800 text-sm">
                    <div className="text-gray-200 leading-relaxed">{row.event}</div>
                    <div className="text-gray-300 leading-relaxed">{row.mechanism}</div>
                    <div className="text-gray-300">{row.chainPosition}</div>
                    <div className="text-gray-300 leading-relaxed">{row.impact}</div>
                    <div className="text-gray-400 leading-relaxed">{row.verify}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section id="matrix">
            <div className="flex items-start gap-3 mb-6">
              <Target className="w-4 h-4 text-gray-400 mt-1" />
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">矩阵</h2>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {impactMatrix.map((item) => (
                <div key={item.label} className="border border-gray-800 bg-[#0a0a0a] p-5 rounded-lg">
                  <div className={clsx('inline-flex text-[10px] px-2 py-1 rounded border uppercase tracking-wider', toneClass(item.tone))}>
                    {item.label}
                  </div>
                  <div className="text-sm text-gray-300 leading-relaxed mt-4">{item.detail}</div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-start gap-3 mb-6">
              <Sparkles className="w-4 h-4 text-gray-400 mt-1" />
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">相似事件</h2>
              </div>
            </div>

            <div className="border border-gray-800 bg-[#0a0a0a] p-4 rounded-lg text-sm text-gray-400 leading-relaxed mb-6">
              {displayAnalysis.similarEventsSummary}
            </div>

            <div className="grid md:grid-cols-4 gap-4 mb-6">
              <div className="border border-gray-800 bg-[#0a0a0a] p-4 rounded-lg">
                <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">事件类型匹配</div>
                <div className="text-sm text-gray-200">{eventType.label}</div>
              </div>
              <div className="border border-gray-800 bg-[#0a0a0a] p-4 rounded-lg">
                <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">市场窗口</div>
                <div className="text-sm text-gray-200">{event.market}</div>
              </div>
              <div className="border border-gray-800 bg-[#0a0a0a] p-4 rounded-lg">
                <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">可用样本</div>
                <div className="text-sm text-gray-200">{relatedEvents.length + sameMarketContext.length} 条近似事件</div>
              </div>
              <div className="border border-gray-800 bg-[#0a0a0a] p-4 rounded-lg">
                <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">统计状态</div>
                <div className="text-sm text-gray-200">样本不足，未做均值回测</div>
              </div>
            </div>

            <div className="space-y-4">
              {[...relatedEvents, ...sameMarketContext].slice(0, 5).map((item) => (
                <Link
                  key={item.id}
                  to={`/event/${item.id}`}
                  className="block border border-gray-800 bg-[#0a0a0a] p-4 rounded-lg hover:border-gray-600 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm text-gray-200 leading-relaxed">{item.title}</div>
                      <div className="text-[10px] uppercase tracking-widest text-gray-500 mt-3">
                        {item.market} · {getRelativeTimeLabel(item.timestamp)}
                      </div>
                    </div>
                    <div className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-300 uppercase tracking-wider shrink-0">
                      近似事件
                    </div>
                  </div>
                </Link>
              ))}
              {[...relatedEvents, ...sameMarketContext].length === 0 ? (
                <div className="border border-gray-800 bg-[#0a0a0a] p-4 rounded-lg text-sm text-gray-500">
                  暂无足够样本。
                </div>
              ) : null}
            </div>
          </section>

          <section id="evidence">
            <div className="flex items-start gap-3 mb-6">
              <ShieldAlert className="w-4 h-4 text-gray-400 mt-1" />
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">证据</h2>
              </div>
            </div>

            <div className="space-y-4">
              {evidenceLedger.map((item) => (
                <div key={item.type} className="border border-gray-800 bg-[#0a0a0a] p-4 rounded-lg">
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-sm font-semibold text-gray-200">{item.type}</div>
                    <div className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-300 uppercase tracking-wider">
                      {item.status}
                    </div>
                  </div>
                  <div className="text-sm text-gray-300 leading-relaxed mt-3">{item.summary}</div>
                  <div className="text-xs text-gray-500 leading-relaxed mt-3">{item.boundary}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 space-y-4">
              {watchPoints.map((item) => (
                <div key={item} className="border border-gray-800 bg-[#0a0a0a] p-4 rounded-lg text-sm text-gray-300 flex items-start gap-3">
                  <CheckCircle2 className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                  <span>{item}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 grid md:grid-cols-3 gap-4">
              {counterSignals.map((item) => (
                <div key={item} className="border border-gray-800 bg-gray-900/30 p-4 rounded-lg text-sm text-gray-400 leading-relaxed">
                  {item}
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-8">
          <section id="sources" className="border border-gray-800 bg-[#0a0a0a] p-5 rounded-lg">
            <div className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200 mb-6">来源</div>
            <div className="space-y-6">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">原文入口</div>
                {event.sourceUrl ? (
                  <a
                    href={event.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors break-all"
                  >
                    <ExternalLink className="w-4 h-4 shrink-0" />
                    {event.sourceUrl}
                  </a>
                ) : (
                  <div className="flex items-start gap-2 text-sm text-gray-400 leading-relaxed">
                    <CircleSlash className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>暂无原文链接。</span>
                  </div>
                )}
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">来源类型</div>
                <p className="text-sm text-gray-400 leading-relaxed">{sourceLabel}</p>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">事件定义</div>
                <p className="text-sm text-gray-400 leading-relaxed">
                  {event.market} 市场中的 {eventType.label} 事件。
                </p>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">数据口径</div>
                <p className="text-sm text-gray-400 leading-relaxed">基于免费事件快照生成。</p>
              </div>
            </div>
          </section>

          <section className="border border-gray-800 bg-[#0a0a0a] p-5 rounded-lg">
            <div className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200 mb-6">同市场上下文</div>
            <div className="space-y-4">
              {sameMarketContext.length > 0 ? (
                sameMarketContext.map((item) => {
                  const itemShift = getHeatShift(item);

                  return (
                    <Link
                      key={item.id}
                      to={`/event/${item.id}`}
                      className="block border border-gray-800 bg-gray-900/30 p-4 rounded hover:border-gray-600 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="text-sm text-gray-300 leading-relaxed">{item.title}</div>
                        <div className="text-sm font-semibold shrink-0" style={{ color: itemShift >= 0 ? '#ef4444' : '#6b7280' }}>
                          {itemShift >= 0 ? '+' : ''}
                          {itemShift.toFixed(1)}°
                        </div>
                      </div>
                      <div className="text-[10px] uppercase tracking-widest text-gray-500 mt-3">
                        {getRelativeTimeLabel(item.timestamp)}
                      </div>
                    </Link>
                  );
                })
              ) : (
                <div className="text-sm text-gray-500">暂无更多事件。</div>
              )}
            </div>
          </section>

          <section className="border border-gray-800 bg-[#0a0a0a] p-5 rounded-lg">
            <div className="flex items-start gap-3 mb-6">
              <Target className="w-4 h-4 text-gray-400 mt-1" />
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">匹配</h2>
              </div>
            </div>

            <div className="space-y-4">
              {researchFit.map((item) => (
                <div key={item} className="border border-gray-800 bg-gray-900/30 p-4 rounded-lg text-sm text-gray-300 leading-relaxed">
                  {item}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
