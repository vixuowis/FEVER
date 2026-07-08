import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  GitMerge,
  Radar,
  Search,
  ShieldAlert,
  Sparkles,
  Target,
} from 'lucide-react';
import { useFeverStore } from '../store';
import {
  findRelatedEvents,
  getFraming,
  getFreshness,
  getHeatShift,
  getMovementRead,
  getRelativeTimeLabel,
  getScenarioMatrix,
  getSignalQuality,
  getWatchPoints,
} from '../lib/eventIntel';
import { clsx } from 'clsx';

function toneClass(tone: 'high' | 'medium' | 'low') {
  if (tone === 'high') return 'text-red-400 border-red-900 bg-red-950/20';
  if (tone === 'medium') return 'text-yellow-400 border-yellow-900 bg-yellow-950/20';
  return 'text-blue-400 border-blue-900 bg-blue-950/20';
}

export default function EventDetail() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { events, createSessionFromEvent, targetAssets } = useFeverStore();

  const event = useMemo(
    () => events.find((item) => item.id === eventId),
    [events, eventId]
  );

  useEffect(() => {
    if (event) {
      createSessionFromEvent(event);
    }
  }, [event, createSessionFromEvent]);

  const relatedEvents = useMemo(
    () => (event ? findRelatedEvents(events, event) : []),
    [event, events]
  );

  const sameMarketContext = useMemo(() => {
    if (!event) return [];

    return events
      .filter((item) => item.id !== event.id && item.market === event.market)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 4);
  }, [event, events]);

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

  const freshness = getFreshness(event);
  const signal = getSignalQuality(event);
  const heatShift = getHeatShift(event);
  const framing = getFraming(event);
  const scenarios = getScenarioMatrix(event);
  const watchPoints = getWatchPoints(event);
  const targetMatches = event.impactAssets.filter((asset) => targetAssets.includes(asset));

  return (
    <div className="h-full flex flex-col gap-12">
      <div className="pt-4 pb-8 border-b border-gray-800">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-6">
          <Link to="/" className="hover:text-gray-300 transition-colors">
            信号总览
          </Link>
          <ArrowRight className="w-3 h-3" />
          <span>{event.market}</span>
          <ArrowRight className="w-3 h-3" />
          <span className="text-gray-400">{framing}</span>
        </div>

        <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-8">
          <div className="max-w-3xl">
            <h1 className="text-3xl font-bold text-gray-100 leading-tight mb-4">{event.title}</h1>
            
            <div className="flex flex-wrap gap-2 mb-6">
              <span className="text-[10px] px-2 py-1 rounded bg-gray-800 text-gray-300 uppercase tracking-wider">
                {event.market}
              </span>
              <span className={clsx('text-[10px] px-2 py-1 rounded border uppercase tracking-wider', toneClass(signal.tone))}>
                Signal {signal.label}
              </span>
              <span className={clsx('text-[10px] px-2 py-1 rounded border uppercase tracking-wider', toneClass(freshness.tone))}>
                {freshness.label}
              </span>
            </div>

            <p className="text-sm text-gray-400 leading-relaxed mb-4">
              {event.description}
            </p>
            <p className="text-xs text-gray-500 leading-relaxed">
              {getMovementRead(event)}
            </p>
          </div>

          <div className="flex flex-wrap gap-3 shrink-0">
            <button
              onClick={() => navigate('/graph')}
              className="px-4 py-2 border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700 transition-colors flex items-center gap-2 text-xs font-semibold uppercase tracking-wider rounded"
            >
              <GitMerge className="w-4 h-4" />
              图谱推演
            </button>
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 border border-gray-800 text-gray-400 hover:text-gray-200 transition-colors flex items-center gap-2 text-xs font-semibold uppercase tracking-wider rounded"
            >
              <ArrowLeft className="w-4 h-4" />
              返回总览
            </button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="flex flex-wrap gap-12 mt-12">
          <div>
            <div className="text-[10px] text-fever-500/70 uppercase tracking-widest mb-1">Current Fever</div>
            <div className="text-2xl font-semibold text-fever-500">{event.feverLevel.toFixed(0)}°</div>
          </div>
          <div>
            <div className="text-[10px] text-fever-500/70 uppercase tracking-widest mb-1">Baseline Shift</div>
            <div className={clsx('text-2xl font-semibold', heatShift >= 0 ? 'text-fever-400' : 'text-gray-400')}>
              {heatShift >= 0 ? '+' : ''}
              {heatShift.toFixed(1)}°
            </div>
          </div>
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Impact Assets</div>
            <div className="text-2xl font-semibold text-gray-100">{event.impactAssets.length}</div>
            <div className="text-[10px] text-gray-500 mt-1">
              {targetMatches.length > 0 ? `Hits: ${targetMatches.join(', ')}` : 'No tracked assets hit'}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Last Seen</div>
            <div className="text-xl font-semibold text-gray-100">{getRelativeTimeLabel(event.timestamp)}</div>
            <div className="text-[10px] text-gray-500 mt-1">{new Date(event.timestamp).toLocaleString()}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.9fr)] gap-12">
        <div className="flex flex-col gap-12">
          <section>
            <div className="flex items-start gap-3 mb-6">
              <Radar className="w-4 h-4 text-gray-400 mt-1" />
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">事件快照</h2>
                <p className="text-xs text-gray-500 mt-1">优先检视客观市场数据与事实变化，确认信号基础。</p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="border border-gray-800 bg-[#0a0a0a] p-5 rounded-lg">
                <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-3 font-semibold">What Changed</div>
                <p className="text-sm text-gray-300 leading-relaxed">{event.description}</p>
              </div>
              <div className="border border-gray-800 bg-[#0a0a0a] p-5 rounded-lg">
                <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-3 font-semibold">Movement Read</div>
                <p className="text-sm text-gray-300 leading-relaxed">{getMovementRead(event)}</p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              {event.impactAssets.map((asset) => (
                <span
                  key={asset}
                  className={clsx(
                    'text-[10px] px-2.5 py-1 rounded border uppercase tracking-wider',
                    targetMatches.includes(asset)
                      ? 'border-gray-500 bg-gray-800 text-gray-200'
                      : 'border-gray-800 bg-[#0a0a0a] text-gray-400'
                  )}
                >
                  {asset}
                </span>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-start gap-3 mb-6">
              <Sparkles className="w-4 h-4 text-gray-400 mt-1" />
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">详情分析</h2>
                <p className="text-xs text-gray-500 mt-1">解构事件传导链条，提供多维度情景推演与影响评估。</p>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {scenarios.map((scenario) => (
                <div key={scenario.title} className="border border-gray-800 bg-[#0a0a0a] p-5 rounded-lg">
                  <div className={clsx('inline-flex text-[10px] px-2 py-1 rounded border uppercase mb-4 tracking-wider', toneClass(scenario.tone))}>
                    {scenario.title}
                  </div>
                  <p className="text-sm text-gray-300 leading-relaxed">{scenario.summary}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 grid md:grid-cols-2 gap-6">
              <div className="border border-gray-800 bg-[#0a0a0a] p-5 rounded-lg">
                <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-3 font-semibold">Signal Assessment</div>
                <p className="text-sm text-gray-300 leading-relaxed">{signal.detail}</p>
                <p className="text-xs text-gray-500 mt-4 pt-4 border-t border-gray-800">当前判定：{signal.label} signal，{freshness.detail}。</p>
              </div>
              <div className="border border-gray-800 bg-[#0a0a0a] p-5 rounded-lg">
                <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-3 font-semibold">Transmission Hint</div>
                <p className="text-sm text-gray-300 leading-relaxed">
                  该事件首先会经由 <span className="text-gray-200 font-semibold">{event.market}</span> 市场的风险偏好变化向
                  <span className="text-gray-200 font-semibold"> {event.impactAssets.join(' / ') || '相关资产'}</span> 传导，
                  随后再决定是否进入更广的跨资产扩散。
                </p>
              </div>
            </div>
          </section>

          <section>
            <div className="flex items-start gap-3 mb-6">
              <ShieldAlert className="w-4 h-4 text-gray-400 mt-1" />
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">监控清单</h2>
                <p className="text-xs text-gray-500 mt-1">锁定关键验证节点与潜在次生风险，明确后续观察指标。</p>
              </div>
            </div>

            <div className="space-y-4">
              {watchPoints.map((item) => (
                <div key={item} className="border border-gray-800 bg-[#0a0a0a] p-4 rounded-lg text-sm text-gray-300">
                  {item}
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-8">
          <section className="border border-gray-800 bg-[#0a0a0a] p-5 rounded-lg">
            <div className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200 mb-6">来源与定义</div>
            <div className="space-y-6">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Source Layer</div>
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
                  <a
                    href={`https://www.google.com/search?q=${encodeURIComponent(event.title + ' finance news')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    <Search className="w-4 h-4 shrink-0" />
                    搜索更多上下文
                  </a>
                )}
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Event Definition</div>
                <p className="text-sm text-gray-400 leading-relaxed">
                  本页把该事件视为一个 <span className="text-gray-200">{event.market}</span> 市场中的
                  <span className="text-gray-200"> 热度冲击源</span>，用于观察它如何经由受影响资产向后续信号传导。
                </p>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Research Match</div>
                <p className="text-sm text-gray-400 leading-relaxed">
                  {targetMatches.length > 0
                    ? `该事件直接命中当前研究标的：${targetMatches.join(' / ')}。`
                    : '该事件暂未直接命中当前研究标的，但仍可能通过宏观或情绪路径间接传导。'}
                </p>
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
                <div className="text-sm text-gray-500">该市场暂无更多可对照的事件。</div>
              )}
            </div>
          </section>

          <section className="border border-gray-800 bg-[#0a0a0a] p-5 rounded-lg">
            <div className="flex items-start gap-3 mb-6">
              <Target className="w-4 h-4 text-gray-400 mt-1" />
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-gray-200">关联事件</h2>
                <p className="text-xs text-gray-500 mt-1">追踪跨市场资金流动，发现隐性传导链条。</p>
              </div>
            </div>

            <div className="space-y-4">
              {relatedEvents.length > 0 ? (
                relatedEvents.map((item) => (
                  <Link
                    key={item.id}
                    to={`/event/${item.id}`}
                    className="block border border-gray-800 bg-gray-900/30 p-4 rounded hover:border-gray-600 transition-colors"
                  >
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <div className="text-sm text-gray-300 leading-relaxed">{item.title}</div>
                        <div className="text-[10px] uppercase tracking-widest text-gray-500 mt-3">
                          {item.market} · {getRelativeTimeLabel(item.timestamp)}
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-fever-500 shrink-0">{item.feverLevel.toFixed(0)}°</div>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="text-sm text-gray-500">暂无足够强的关联事件。</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
