import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  Layers3,
  Plus,
  Radar,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  X,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import { useFeverStore, type Event } from '../store';
import {
  getEventMixSummary,
  getEventType,
  getFreshness,
  getHeatShift,
  getMarketSummary,
  getMovementRead,
  getPriorityScore,
  getRelativeTimeLabel,
  getResearchSummary,
  getSignalQuality,
} from '../lib/eventIntel';

function toneClass(tone: 'high' | 'medium' | 'low') {
  if (tone === 'high') return 'border-fever-500/40 bg-fever-900/10 text-fever-400';
  if (tone === 'medium') return 'border-cyber-yellow/30 bg-cyber-yellow/10 text-cyber-yellow';
  return 'border-cyber-blue/30 bg-cyber-blue/10 text-cyber-blue';
}

const MARKET_OPTIONS = [
  { value: 'Asia', label: 'A股' },
  { value: 'Global', label: '全球' },
  { value: 'US', label: '美股' },
  { value: 'EU', label: '欧洲' },
] as const;

const TYPE_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'macro', label: '宏观' },
  { value: 'flow', label: '资金' },
  { value: 'sector', label: '行业' },
  { value: 'policy', label: '政策' },
  { value: 'company', label: '个股' },
] as const;

const SOURCE_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'macro', label: '宏观源' },
  { value: 'flow', label: '资金流' },
  { value: 'etf', label: 'ETF' },
  { value: 'theme', label: '主题基金' },
  { value: 'stock', label: '热股' },
  { value: 'snapshot', label: '快照' },
] as const;

const FRESHNESS_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'fresh', label: '最新' },
  { value: 'active', label: '日内' },
  { value: 'aging', label: '较早' },
] as const;

const COMMON_ASSET_SUGGESTIONS = [
  '沪深300',
  '中证1000',
  '上证50',
  '创业板',
  '科创50',
  '恒生指数',
  '恒生科技',
  '中概互联网',
  '北向资金',
  '南向资金',
  '半导体',
  '创新药',
  '券商',
  '银行',
  '煤炭',
  '黄金',
  '原油',
];

function normalizeAssetLabel(value: string) {
  return value.trim().toUpperCase();
}

function getTargetMatchCount(event: Event, targetAssets: string[]) {
  const targetSet = new Set(targetAssets.map(normalizeAssetLabel));
  return event.impactAssets.filter((asset) => targetSet.has(normalizeAssetLabel(asset))).length;
}

function getProviderGroup(provider?: string) {
  if (!provider) return 'all';
  if (provider.includes('macro')) return 'macro';
  if (provider.includes('fund_flow')) return 'flow';
  if (provider.includes('etf')) return 'etf';
  if (provider.includes('theme_fund')) return 'theme';
  if (provider.includes('stock_hot')) return 'stock';
  if (provider === 'free_snapshot') return 'snapshot';
  return 'all';
}

function EventActionButtons({ event, onOpenDetail, onOpenGraph }: {
  event: Event;
  onOpenDetail: (event: Event) => void;
  onOpenGraph: (event: Event) => void;
}) {
  return (
    <div className="flex gap-2 pt-4">
      <button
        onClick={() => onOpenDetail(event)}
        className="flex-1 border border-obsidian-600 px-3 py-2 text-xs uppercase tracking-wider text-gray-300 hover:border-cyber-blue hover:text-cyber-blue transition-colors"
      >
        详情分析
      </button>
      <button
        onClick={() => onOpenGraph(event)}
        className="flex-1 border border-cyber-blue/40 px-3 py-2 text-xs uppercase tracking-wider text-cyber-blue hover:bg-cyber-blue/10 transition-colors"
      >
        图谱推演
      </button>
    </div>
  );
}

function MetricCard({ label, value, detail, accent = 'text-gray-100' }: {
  label: string;
  value: string;
  detail: string;
  accent?: string;
}) {
  return (
    <div className="border border-gray-800 bg-[#0a0a0a] p-4 rounded-lg">
      <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-2">{label}</div>
      <div className={clsx('text-2xl font-semibold', accent)}>{value}</div>
      <div className="text-xs text-gray-500 mt-2 leading-relaxed">{detail}</div>
    </div>
  );
}

function EventOverviewCard({
  event,
  targetAssets,
  onOpenDetail,
  onOpenGraph,
}: {
  event: Event;
  targetAssets: string[];
  onOpenDetail: (event: Event) => void;
  onOpenGraph: (event: Event) => void;
}) {
  const freshness = getFreshness(event);
  const signal = getSignalQuality(event);
  const heatShift = getHeatShift(event);
  const eventType = getEventType(event);
  const targetMatches = event.impactAssets.filter((asset) => targetAssets.includes(asset));
  const summary = getResearchSummary(event, targetAssets);

  return (
    <div className="border border-gray-800 hover:border-gray-600 bg-[#0a0a0a] p-5 rounded-lg transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          <span className="text-[10px] px-2 py-1 rounded bg-gray-800 text-gray-300 uppercase tracking-wider">
            {event.market}
          </span>
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
        <div className="text-right shrink-0">
          <div className={clsx('text-lg font-semibold', heatShift >= 0 ? 'text-fever-400' : 'text-gray-400')}>
            {event.feverLevel.toFixed(0)}°
          </div>
          <div className="text-[10px] uppercase tracking-widest text-gray-500">
            {heatShift >= 0 ? '+' : ''}{heatShift.toFixed(1)}° vs base
          </div>
        </div>
      </div>

      <button
        onClick={() => onOpenDetail(event)}
        className="mt-4 text-left text-base font-semibold text-gray-100 hover:text-white transition-colors leading-relaxed"
      >
        {event.title}
      </button>
      <p className="text-sm text-gray-500 mt-3 line-clamp-2 leading-relaxed">{event.description}</p>

      <div className="mt-4 space-y-2">
        {summary.slice(0, 2).map((item) => (
          <div key={item} className="text-xs text-gray-400 leading-relaxed">
            {item}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        {event.impactAssets.slice(0, 3).map((asset) => (
          <span
            key={asset}
            className={clsx(
              'text-[10px] uppercase tracking-wider px-2 py-1 border rounded',
              targetMatches.includes(asset)
                ? 'border-gray-500 bg-gray-800 text-gray-200'
                : 'border-gray-700 bg-gray-900 text-gray-300'
            )}
          >
            {asset}
          </span>
        ))}
      </div>

      <div className="mt-4 text-[10px] uppercase tracking-widest text-gray-500">
        {getRelativeTimeLabel(event.timestamp)} · {targetMatches.length > 0 ? `命中标的 ${targetMatches.join(' / ')}` : eventType.detail}
      </div>

      <EventActionButtons event={event} onOpenDetail={onOpenDetail} onOpenGraph={onOpenGraph} />
    </div>
  );
}

export default function Home() {
  const {
    events,
    globalFever,
    activeMarket,
    setActiveMarket,
    createSessionFromEvent,
    targetAssets,
    addTargetAsset,
    removeTargetAsset,
    reloadFreeEvents,
    isInitializing,
    freeSourceStatus,
    freeSourceMessage,
  } = useFeverStore();
  const navigate = useNavigate();
  const [assetInput, setAssetInput] = useState('');
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTERS)[number]['value']>('all');
  const [sourceFilter, setSourceFilter] = useState<(typeof SOURCE_FILTERS)[number]['value']>('all');
  const [freshnessFilter, setFreshnessFilter] = useState<(typeof FRESHNESS_FILTERS)[number]['value']>('all');
  const [onlyFollowed, setOnlyFollowed] = useState(false);

  const marketEvents = useMemo(
    () => events.filter((event) => activeMarket === 'Global' || event.market === activeMarket || event.market === 'Global'),
    [events, activeMarket]
  );

  const filteredEvents = useMemo(
    () =>
      marketEvents.filter((event) => {
        if (typeFilter !== 'all' && getEventType(event).key !== typeFilter) {
          return false;
        }

        if (sourceFilter !== 'all' && getProviderGroup(event.provider) !== sourceFilter) {
          return false;
        }

        const freshness = getFreshness(event);
        if (freshnessFilter === 'fresh' && freshness.tone !== 'high') {
          return false;
        }
        if (freshnessFilter === 'active' && freshness.tone === 'low') {
          return false;
        }
        if (freshnessFilter === 'aging' && freshness.tone !== 'low') {
          return false;
        }

        if (onlyFollowed && getTargetMatchCount(event, targetAssets) === 0) {
          return false;
        }

        return true;
      }),
    [marketEvents, typeFilter, sourceFilter, freshnessFilter, onlyFollowed, targetAssets]
  );

  const rankedEvents = useMemo(
    () =>
      [...filteredEvents]
        .sort((a, b) => {
          const matchDiff = getTargetMatchCount(b, targetAssets) - getTargetMatchCount(a, targetAssets);
          if (matchDiff !== 0) return matchDiff;

          const priorityDiff = getPriorityScore(b, targetAssets) - getPriorityScore(a, targetAssets);
          if (priorityDiff !== 0) return priorityDiff;

          return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        })
        .slice(0, 16),
    [filteredEvents, targetAssets]
  );

  const followedEvents = useMemo(
    () =>
      [...filteredEvents]
        .filter((event) => getTargetMatchCount(event, targetAssets) > 0)
        .sort((a, b) => {
          const matchDiff = getTargetMatchCount(b, targetAssets) - getTargetMatchCount(a, targetAssets);
          if (matchDiff !== 0) return matchDiff;
          return getPriorityScore(b, targetAssets) - getPriorityScore(a, targetAssets);
        })
        .slice(0, 6),
    [filteredEvents, targetAssets]
  );

  const marketSummary = useMemo(() => getMarketSummary(events), [events]);
  const eventMix = useMemo(() => getEventMixSummary(filteredEvents), [filteredEvents]);
  const leadEvent = followedEvents[0] ?? rankedEvents[0];
  const freshEventCount = useMemo(
    () => filteredEvents.filter((event) => getFreshness(event).tone === 'high').length,
    [filteredEvents]
  );
  const watchlistHitCount = useMemo(
    () => filteredEvents.filter((event) => getTargetMatchCount(event, targetAssets) > 0).length,
    [filteredEvents, targetAssets]
  );
  const strongestShift = rankedEvents[0] ? Math.abs(getHeatShift(rankedEvents[0])).toFixed(1) : '0.0';
  const assetSuggestions = useMemo(() => {
    const frequency = new Map<string, number>();

    COMMON_ASSET_SUGGESTIONS.forEach((asset, index) => {
      frequency.set(asset, 50 - index);
    });

    events.forEach((event) => {
      event.impactAssets.forEach((asset) => {
        frequency.set(asset, (frequency.get(asset) ?? 0) + 1);
      });
    });

    targetAssets.forEach((asset) => {
      frequency.set(asset, (frequency.get(asset) ?? 0) + 100);
    });

    const query = normalizeAssetLabel(assetInput);
    return [...frequency.entries()]
      .map(([asset, score]) => ({ asset, score }))
      .filter(({ asset }) => !targetAssets.includes(asset))
      .filter(({ asset }) => !query || normalizeAssetLabel(asset).includes(query))
      .sort((a, b) => {
        const aStarts = query ? normalizeAssetLabel(a.asset).startsWith(query) : false;
        const bStarts = query ? normalizeAssetLabel(b.asset).startsWith(query) : false;
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        return b.score - a.score || a.asset.localeCompare(b.asset, 'zh-Hans-CN');
      })
      .slice(0, 8)
      .map((item) => item.asset);
  }, [assetInput, events, targetAssets]);

  const handleOpenDetail = (event: Event) => {
    createSessionFromEvent(event);
    navigate(`/event/${event.id}`);
  };

  const handleOpenGraph = (event: Event) => {
    createSessionFromEvent(event);
    navigate('/graph');
  };

  const handleAddAsset = (e?: React.FormEvent) => {
    e?.preventDefault();
    const typed = assetInput.trim();
    if (!typed) return;
    const exactSuggestion = assetSuggestions.find(
      (asset) => normalizeAssetLabel(asset) === normalizeAssetLabel(typed),
    );
    addTargetAsset(exactSuggestion ?? typed.toUpperCase());
    setAssetInput('');
  };

  const handleSelectAsset = (asset: string) => {
    addTargetAsset(asset);
    setAssetInput('');
  };

  const isEmptyState = !isInitializing && rankedEvents.length === 0;

  return (
    <div className="h-full flex flex-col gap-12">
      <section className="pt-4 pb-8 border-b border-gray-800">
        <div className="max-w-4xl">
          <div className="text-[10px] uppercase tracking-[0.25em] text-gray-500 mb-3">Signal Scan</div>
          <h1 className="text-3xl font-bold text-gray-100 leading-tight mb-4">先看事件，再做研究。</h1>
          <p className="text-sm text-gray-400 leading-relaxed">按优先级查看最新事件。</p>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mt-8">
          <MetricCard label="热度" value={`${globalFever.toFixed(1)}°`} detail="市场基线" accent="text-fever-500" />
          <MetricCard label="队列" value={`${filteredEvents.length}`} detail="筛选结果" accent="text-gray-100" />
          <MetricCard label="命中" value={`${watchlistHitCount}`} detail="关注资产" accent="text-cyber-blue" />
          <MetricCard label="新信号" value={`${freshEventCount}`} detail={`偏移 ${strongestShift}°`} accent="text-fever-400" />
        </div>
      </section>

      {freeSourceMessage ? (
        <section className="border border-gray-800 bg-[#0a0a0a] rounded-lg p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-2">
                数据状态
              </div>
              <p className="text-sm text-gray-300 leading-relaxed">{freeSourceMessage}</p>
            </div>
            <button
              onClick={() => reloadFreeEvents()}
              disabled={isInitializing}
              className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded border border-gray-700 text-xs uppercase tracking-wider text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={clsx('w-3.5 h-3.5', isInitializing && 'animate-spin')} />
              重试拉取
            </button>
          </div>
        </section>
      ) : null}

      <section className="border border-gray-800 bg-[#0a0a0a] rounded-lg p-5">
        <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr_1fr_1fr]">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-3">市场</div>
            <div className="flex flex-wrap gap-2">
              {MARKET_OPTIONS.map((market) => (
                <button
                  key={market.value}
                  onClick={() => setActiveMarket(market.value)}
                  className={clsx(
                    'px-3 py-1.5 text-xs rounded transition-colors',
                    activeMarket === market.value
                      ? 'bg-gray-200 text-gray-900'
                      : 'bg-gray-900 text-gray-400 border border-gray-800 hover:border-gray-600'
                  )}
                >
                  {market.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-3">类型</div>
            <div className="flex flex-wrap gap-2">
              {TYPE_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  onClick={() => setTypeFilter(filter.value)}
                  className={clsx(
                    'px-3 py-1.5 text-xs rounded transition-colors',
                    typeFilter === filter.value
                      ? 'bg-gray-200 text-gray-900'
                      : 'bg-gray-900 text-gray-400 border border-gray-800 hover:border-gray-600'
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-3">来源</div>
            <div className="flex flex-wrap gap-2">
              {SOURCE_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  onClick={() => setSourceFilter(filter.value)}
                  className={clsx(
                    'px-3 py-1.5 text-xs rounded transition-colors',
                    sourceFilter === filter.value
                      ? 'bg-gray-200 text-gray-900'
                      : 'bg-gray-900 text-gray-400 border border-gray-800 hover:border-gray-600'
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-3">时效</div>
            <div className="flex flex-wrap gap-2">
              {FRESHNESS_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  onClick={() => setFreshnessFilter(filter.value)}
                  className={clsx(
                    'px-3 py-1.5 text-xs rounded transition-colors',
                    freshnessFilter === filter.value
                      ? 'bg-gray-200 text-gray-900'
                      : 'bg-gray-900 text-gray-400 border border-gray-800 hover:border-gray-600'
                  )}
                >
                  {filter.label}
                </button>
              ))}
              <button
                onClick={() => setOnlyFollowed((value) => !value)}
                className={clsx(
                  'px-3 py-1.5 text-xs rounded transition-colors border',
                  onlyFollowed
                    ? 'bg-blue-100 text-gray-900 border-blue-200'
                    : 'bg-gray-900 text-gray-400 border-gray-800 hover:border-gray-600'
                )}
              >
                仅看关注相关
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_320px] gap-12">
        <div className="flex flex-col gap-12">
          {isEmptyState ? (
            <section className="border border-gray-800 bg-[#0a0a0a] rounded-lg p-8">
              <div className="flex items-start gap-3 mb-5">
                <Activity className="w-4 h-4 text-gray-400 mt-1" />
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">暂无事件</h2>
                  <p className="text-xs text-gray-500 mt-1">仅显示免费源事件。</p>
                </div>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed">
                {freeSourceMessage || '当前没有可用事件，请稍后重试。'}
              </p>
              <div className="flex flex-wrap gap-3 mt-6">
                <button
                  onClick={() => reloadFreeEvents()}
                  disabled={isInitializing}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded border border-gray-700 text-sm text-gray-200 hover:border-gray-500 hover:bg-gray-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw className={clsx('w-4 h-4', isInitializing && 'animate-spin')} />
                  重新拉取免费事件
                </button>
                <button
                  onClick={() => setActiveMarket('Global')}
                  className="px-4 py-2 rounded border border-gray-800 text-sm text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors"
                >
                  回到 Global 观察
                </button>
              </div>
            </section>
          ) : null}

          {leadEvent ? (
            <section>
              <div className="flex items-start gap-3 mb-6">
                <Sparkles className="w-4 h-4 text-gray-400 mt-1" />
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">焦点</h2>
                </div>
              </div>

              <div className="border border-gray-800 bg-[#0a0a0a] p-6 rounded-lg">
                <div className="flex flex-wrap gap-2 mb-4">
                  <span className="text-[10px] px-2 py-1 rounded bg-gray-800 text-gray-300 uppercase tracking-wider">{leadEvent.market}</span>
                  <span className={clsx('text-[10px] px-2 py-1 rounded border uppercase tracking-wider', toneClass(getEventType(leadEvent).tone))}>
                    {getEventType(leadEvent).label}
                  </span>
                  <span className={clsx('text-[10px] px-2 py-1 rounded border uppercase tracking-wider', toneClass(getSignalQuality(leadEvent).tone))}>
                    {getSignalQuality(leadEvent).label}
                  </span>
                </div>

                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_260px]">
                  <div>
                    <button
                      onClick={() => handleOpenDetail(leadEvent)}
                      className="text-left text-2xl font-semibold text-gray-100 hover:text-white transition-colors leading-tight"
                    >
                      {leadEvent.title}
                    </button>
                    <p className="text-sm text-gray-400 leading-relaxed mt-4">{leadEvent.description}</p>

                    <div className="space-y-3 mt-5">
                      {getResearchSummary(leadEvent, targetAssets).map((item) => (
                        <div key={item} className="text-sm text-gray-300 leading-relaxed">
                          {item}
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-2 mt-5">
                      {leadEvent.impactAssets.map((asset) => (
                        <span
                          key={asset}
                          className={clsx(
                            'text-[10px] uppercase tracking-wider px-2 py-1 border rounded',
                            targetAssets.includes(asset)
                              ? 'border-gray-500 bg-gray-800 text-gray-100'
                              : 'border-gray-700 bg-gray-900 text-gray-300'
                          )}
                        >
                          {asset}
                        </span>
                      ))}
                    </div>

                    <EventActionButtons event={leadEvent} onOpenDetail={handleOpenDetail} onOpenGraph={handleOpenGraph} />
                  </div>

                  <div className="border border-gray-800 bg-gray-900/40 rounded-lg p-5">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-4">快照</div>
                    <div className="space-y-5">
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Heat</div>
                        <div className="text-2xl font-semibold text-fever-400">{leadEvent.feverLevel.toFixed(0)}°</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Shift</div>
                        <div className={clsx('text-xl font-semibold', getHeatShift(leadEvent) >= 0 ? 'text-fever-400' : 'text-gray-300')}>
                          {getHeatShift(leadEvent) >= 0 ? '+' : ''}{getHeatShift(leadEvent).toFixed(1)}°
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Last Seen</div>
                        <div className="text-sm text-gray-300">{getRelativeTimeLabel(leadEvent.timestamp)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Movement Read</div>
                        <div className="text-sm text-gray-400 leading-relaxed">{getMovementRead(leadEvent)}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {targetAssets.length > 0 ? (
            <section>
              <div className="flex items-start gap-3 mb-6">
                <Target className="w-4 h-4 text-gray-400 mt-1" />
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">关注相关</h2>
                  <p className="text-xs text-gray-500 mt-1">
                    {targetAssets.slice(0, 3).join(' / ') || '关注资产'}
                  </p>
                </div>
              </div>

              {followedEvents.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {followedEvents.map((event, index) => (
                    <motion.div
                      key={`followed-${event.id}`}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <EventOverviewCard
                        event={event}
                        targetAssets={targetAssets}
                        onOpenDetail={handleOpenDetail}
                        onOpenGraph={handleOpenGraph}
                      />
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="border border-gray-800 bg-[#0a0a0a] rounded-lg p-5 text-sm text-gray-500">
                  当前筛选下暂无命中关注资产的事件。
                </div>
              )}
            </section>
          ) : null}

          <section>
            <div className="flex items-start gap-3 mb-6">
              <Radar className="w-4 h-4 text-gray-400 mt-1" />
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">事件总览</h2>
                <p className="text-xs text-gray-500 mt-1">按优先级排序。</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {rankedEvents.map((event, index) => (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <EventOverviewCard
                    event={event}
                    targetAssets={targetAssets}
                    onOpenDetail={handleOpenDetail}
                    onOpenGraph={handleOpenGraph}
                  />
                </motion.div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-start gap-3 mb-6">
              <Layers3 className="w-4 h-4 text-gray-400 mt-1" />
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">分类分布</h2>
                <p className="text-xs text-gray-500 mt-1">看类型分布。</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {eventMix.map((item) => (
                <div key={item.key} className="border border-gray-800 bg-[#0a0a0a] p-4 rounded-lg">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-gray-200">{item.label}</div>
                      <div className="text-[10px] uppercase tracking-widest text-gray-500 mt-1">Signals {item.count}</div>
                    </div>
                    <div className="text-xl font-semibold text-gray-100">{item.avgFever.toFixed(1)}°</div>
                  </div>
                  <div className="text-xs text-gray-500 mt-3 leading-relaxed">{item.detail}</div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-start gap-3 mb-6">
              <TrendingUp className="w-4 h-4 text-gray-400 mt-1" />
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">市场脉冲</h2>
                <p className="text-xs text-gray-500 mt-1">看市场强弱。</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {marketSummary.map((item) => (
                <div key={item.market} className="border border-gray-800 bg-[#0a0a0a] p-4 rounded-lg">
                  <div className="text-sm font-semibold text-gray-200">{item.market}</div>
                  <div className="text-[10px] uppercase tracking-widest text-gray-500 mt-1">Signals {item.count}</div>
                  <div className="text-2xl font-semibold mt-3" style={{ color: item.avgFever > 60 ? '#ef4444' : '#f3f4f6' }}>{item.avgFever.toFixed(1)}°</div>
                  <div className="text-xs text-gray-500 mt-1">Avg Heat · Top shift {item.topShift.toFixed(1)}°</div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-8">
          <section className="border border-gray-800 bg-[#0a0a0a] p-5 rounded-lg">
            <div className="flex items-start gap-3 mb-4">
              <Target className="w-4 h-4 text-gray-400 mt-1" />
              <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">关注资产</h2>
                  <p className="text-xs text-gray-500 mt-1">搜索后加入关注。</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              {targetAssets.map((asset) => (
                <span
                  key={asset}
                  className="text-[10px] bg-gray-800 border border-gray-700 text-gray-300 px-2 py-1 flex items-center gap-1 group rounded"
                >
                  {asset}
                  <button onClick={() => removeTargetAsset(asset)} className="hover:text-red-400 opacity-50 group-hover:opacity-100 transition-all">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>

            <form onSubmit={handleAddAsset} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={assetInput}
                  onChange={(e) => setAssetInput(e.target.value)}
                  placeholder="搜索资产..."
                  className="w-full bg-gray-900 border border-gray-700 text-sm pl-9 pr-3 py-2 rounded focus:outline-none focus:border-gray-500 text-gray-200"
                />
              </div>
              <button
                type="submit"
                className="bg-gray-800 border border-gray-700 p-2 text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors rounded"
              >
                <Plus className="w-4 h-4" />
              </button>
            </form>

            {assetSuggestions.length > 0 ? (
              <div className="flex flex-wrap gap-2 mt-4">
                {assetSuggestions.map((asset) => (
                  <button
                    key={asset}
                    onClick={() => handleSelectAsset(asset)}
                    className="text-[11px] px-2.5 py-1.5 rounded border border-gray-800 bg-gray-900 text-gray-300 hover:text-white hover:border-gray-600 transition-colors"
                  >
                    {asset}
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <section className="border border-gray-800 bg-[#0a0a0a] flex flex-col min-h-[420px] rounded-lg overflow-hidden">
            <div className="p-5 border-b border-gray-800">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Activity className="w-4 h-4 text-gray-400 mt-1" />
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">时间流</h2>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 custom-scrollbar bg-gray-900/30">
              <div className="relative border-l border-gray-800 ml-2 space-y-6">
                {filteredEvents.length > 0 ? (
                  filteredEvents.map((event) => (
                    <div key={event.id} className="relative pl-6">
                      <div className="absolute left-0 top-1.5 w-2 h-2 -ml-1 rounded-full bg-gray-500 ring-4 ring-[#0a0a0a]" />
                      <div className="text-[10px] text-gray-500 font-mono mb-1">{new Date(event.timestamp).toLocaleTimeString()}</div>
                      <div className="flex gap-2 mb-2">
                        <span className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-300 uppercase tracking-wider">{event.market}</span>
                        <span className={clsx('text-[10px] px-2 py-0.5 rounded border uppercase tracking-wider', toneClass(getEventType(event).tone))}>
                          {getEventType(event).label}
                        </span>
                      </div>
                      <button
                        onClick={() => handleOpenDetail(event)}
                        className="text-left text-sm font-semibold text-gray-300 hover:text-white transition-colors"
                      >
                        {event.title}
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="pl-6 text-sm text-gray-500 leading-relaxed">
                    暂无新事件。
                  </div>
                )}
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
