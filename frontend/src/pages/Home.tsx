import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  ExternalLink,
  GitMerge,
  Globe2,
  Plus,
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
  getFreshness,
  getHeatShift,
  getMarketSummary,
  getMovementRead,
  getRelativeTimeLabel,
  getSignalQuality,
} from '../lib/eventIntel';

function toneClass(tone: 'high' | 'medium' | 'low') {
  if (tone === 'high') return 'border-fever-500/40 bg-fever-900/10 text-fever-400';
  if (tone === 'medium') return 'border-cyber-yellow/30 bg-cyber-yellow/10 text-cyber-yellow';
  return 'border-cyber-blue/30 bg-cyber-blue/10 text-cyber-blue';
}

function EventActionButtons({
  event,
  onOpenDetail,
  onOpenGraph,
}: {
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
  } = useFeverStore();
  const navigate = useNavigate();
  const [assetInput, setAssetInput] = useState('');

  const filteredEvents = useMemo(
    () => events.filter((event) => activeMarket === 'Global' || event.market === activeMarket || event.market === 'Global'),
    [events, activeMarket]
  );

  const topSignals = useMemo(
    () =>
      [...filteredEvents]
        .sort((a, b) => {
          const scoreA = Math.abs(getHeatShift(a)) + a.feverLevel;
          const scoreB = Math.abs(getHeatShift(b)) + b.feverLevel;
          return scoreB - scoreA;
        })
        .slice(0, 3),
    [filteredEvents]
  );

  const biggestShifts = useMemo(
    () => [...filteredEvents].sort((a, b) => Math.abs(getHeatShift(b)) - Math.abs(getHeatShift(a))).slice(0, 6),
    [filteredEvents]
  );

  const marketSummary = useMemo(() => getMarketSummary(events), [events]);

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
    if (!assetInput.trim()) return;
    addTargetAsset(assetInput.trim().toUpperCase());
    setAssetInput('');
  };

  const strongestShift = biggestShifts[0] ? Math.abs(getHeatShift(biggestShifts[0])).toFixed(1) : '0.0';

  return (
    <div className="h-full flex flex-col gap-12">
      {/* Header Section */}
      <section className="pt-4 pb-8 border-b border-gray-800">
        <div className="max-w-3xl">
          <div className="text-[10px] uppercase tracking-[0.25em] text-gray-500 mb-3">Signal Scan</div>
          <h1 className="text-3xl font-bold text-gray-100 leading-tight mb-4">
            捕获高置信度市场信号，结构化解析事件传导。
          </h1>
          <p className="text-sm text-gray-400 leading-relaxed">
            基于实时数据流扫描信号强度、热度偏离与资产聚集效应。通过多维指标过滤市场噪音，进入事件详情获取全景结构化分析与情景推演报告。
          </p>
        </div>

        <div className="flex flex-wrap gap-8 mt-8">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-fever-500/70 mb-1">Global Fever</div>
            <div className="text-2xl font-semibold text-fever-500">{globalFever.toFixed(1)}°</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-fever-500/70 mb-1">Strongest Shift</div>
            <div className="text-2xl font-semibold text-fever-400">{strongestShift}°</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Signals Tracked</div>
            <div className="text-2xl font-semibold text-gray-100">{events.length}</div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_320px] gap-12">
        <div className="flex flex-col gap-12">
          {/* Top Signals List */}
          <section>
            <div className="flex items-start gap-3 mb-6">
              <Sparkles className="w-4 h-4 text-gray-400 mt-1" />
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">Top Signals</h2>
                <p className="text-xs text-gray-500 mt-1">优先监控高强度、高时效事件，过滤低置信度噪音。</p>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {topSignals.map((event, index) => {
                const signal = getSignalQuality(event);
                const freshness = getFreshness(event);
                const heatShift = getHeatShift(event);

                return (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.08 }}
                    className="group border border-gray-800 hover:border-gray-600 bg-[#0a0a0a] p-5 rounded-lg transition-colors cursor-pointer"
                    onClick={() => handleOpenDetail(event)}
                  >
                    <div className="flex items-center justify-between gap-4 mb-3">
                      <div className="flex gap-2">
                        <span className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-300 uppercase tracking-wider">
                          {event.market}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded border border-gray-700 text-gray-400 uppercase tracking-wider">
                          {signal.label}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded border border-gray-700 text-gray-400 uppercase tracking-wider">
                          {freshness.label}
                        </span>
                      </div>
                      <div className="text-xs font-mono" style={{ color: heatShift >= 0 ? '#ef4444' : '#6b7280' }}>
                        {event.feverLevel.toFixed(0)}° ({heatShift >= 0 ? '+' : ''}{heatShift.toFixed(1)}°)
                      </div>
                    </div>

                    <h3 className="text-lg font-semibold text-gray-200 group-hover:text-white transition-colors">{event.title}</h3>
                    <p className="text-sm text-gray-500 mt-2 line-clamp-2 leading-relaxed">{event.description}</p>
                    
                    <p className="text-xs text-gray-500 mt-4 leading-relaxed">{getMovementRead(event)}</p>

                    <div className="flex flex-wrap gap-2 mt-4">
                      {event.impactAssets.slice(0, 3).map((asset) => (
                        <span key={asset} className="text-[10px] uppercase tracking-wider px-2 py-1 border border-gray-700 bg-gray-800 text-gray-300 rounded">
                          {asset}
                        </span>
                      ))}
                    </div>

                    <EventActionButtons event={event} onOpenDetail={handleOpenDetail} onOpenGraph={handleOpenGraph} />
                  </motion.div>
                );
              })}
            </div>
          </section>

          <section>
            <div className="flex items-start gap-3 mb-6">
              <TrendingUp className="w-4 h-4 text-gray-400 mt-1" />
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">Heat Shifts</h2>
                <p className="text-xs text-gray-500 mt-1">追踪短时间内热度异常波动的突发事件与趋势逆转。</p>
              </div>
            </div>

            <div className="space-y-4">
              {biggestShifts.map((event) => {
                const heatShift = getHeatShift(event);
                const freshness = getFreshness(event);

                return (
                  <div key={event.id} className="border border-gray-800 bg-[#0a0a0a] p-4 rounded-lg">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <button
                          onClick={() => handleOpenDetail(event)}
                          className="text-left text-sm font-semibold text-gray-200 hover:text-white transition-colors leading-relaxed"
                        >
                          {event.title}
                        </button>
                        <div className="text-[10px] uppercase tracking-widest text-gray-500 mt-2">
                          {event.market} · {getRelativeTimeLabel(event.timestamp)} · {freshness.label}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-lg font-semibold" style={{ color: heatShift >= 0 ? '#ef4444' : '#6b7280' }}>
                          {heatShift >= 0 ? '+' : ''}
                          {heatShift.toFixed(1)}°
                        </div>
                        <div className="text-[10px] uppercase tracking-widest text-gray-500 mt-1">vs baseline</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <div className="flex items-start gap-3 mb-6">
              <Globe2 className="w-4 h-4 text-gray-400 mt-1" />
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">Market Clusters</h2>
                <p className="text-xs text-gray-500 mt-1">扫描区域市场的信号聚集度与宏观风险底数。</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {marketSummary.map((item) => (
                <div key={item.market} className="border border-gray-800 bg-[#0a0a0a] p-4 rounded-lg">
                  <div className="text-sm font-semibold text-gray-200">{item.market}</div>
                  <div className="text-[10px] uppercase tracking-widest text-gray-500 mt-1">Signals {item.count}</div>
                  <div className="text-2xl font-semibold mt-3" style={{ color: item.avgFever > 60 ? '#ef4444' : '#f3f4f6' }}>{item.avgFever.toFixed(1)}°</div>
                  <div className="text-xs text-gray-500 mt-1">Avg Heat</div>
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
                <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">Research Assets</h2>
                <p className="text-xs text-gray-500 mt-1">设定监控资产，在推演中自动高亮。</p>
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
              <input
                type="text"
                value={assetInput}
                onChange={(e) => setAssetInput(e.target.value)}
                placeholder="Add asset symbol..."
                className="flex-1 bg-gray-900 border border-gray-700 text-sm px-3 py-2 rounded focus:outline-none focus:border-gray-500 text-gray-200"
              />
              <button
                type="submit"
                className="bg-gray-800 border border-gray-700 p-2 text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors rounded"
              >
                <Plus className="w-4 h-4" />
              </button>
            </form>
          </section>

          <section className="border border-gray-800 bg-[#0a0a0a] p-5 rounded-lg">
            <div className="flex items-start gap-3 mb-4">
              <Globe2 className="w-4 h-4 text-gray-400 mt-1" />
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">Market Filter</h2>
                <p className="text-xs text-gray-500 mt-1">过滤锁定特定区域市场的风险信号。</p>
              </div>
            </div>
            
            <div className="flex flex-wrap gap-2">
              {['Global', 'US', 'EU', 'Asia'].map((market) => (
                <button
                  key={market}
                  onClick={() => setActiveMarket(market as any)}
                  className={clsx(
                    'px-3 py-1.5 text-xs font-medium rounded transition-colors',
                    activeMarket === market
                      ? 'bg-gray-200 text-gray-900'
                      : 'bg-gray-900 text-gray-400 border border-gray-800 hover:border-gray-600'
                  )}
                >
                  {market}
                </button>
              ))}
            </div>
          </section>

          <section className="border border-gray-800 bg-[#0a0a0a] flex flex-col min-h-[420px] rounded-lg overflow-hidden">
            <div className="p-5 border-b border-gray-800">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Activity className="w-4 h-4 text-gray-400 mt-1" />
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">Live Event Stream</h2>
                    <p className="text-xs text-gray-500 mt-1">实时监控市场异动数据。</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 custom-scrollbar bg-gray-900/30">
              <div className="relative border-l border-gray-800 ml-2 space-y-6">
                {filteredEvents.map((event) => (
                  <div key={event.id} className="relative pl-6">
                    <div className="absolute left-0 top-1.5 w-2 h-2 -ml-1 rounded-full bg-gray-500 ring-4 ring-[#0a0a0a]" />
                    <div className="text-[10px] text-gray-500 font-mono mb-1">{new Date(event.timestamp).toLocaleTimeString()}</div>
                    <button
                      onClick={() => handleOpenDetail(event)}
                      className="text-left text-sm font-semibold text-gray-300 hover:text-white transition-colors"
                    >
                      {event.title}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
