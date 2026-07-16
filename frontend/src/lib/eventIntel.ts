import type { Event } from '../store';

const BASELINE_FEVER = 60;

type Tone = 'high' | 'medium' | 'low';
type EventTypeKey = 'macro' | 'policy' | 'sector' | 'company' | 'flow';

const EVENT_TYPE_META: Record<EventTypeKey, { label: string; detail: string; tone: Tone }> = {
  macro: { label: '宏观', detail: '偏宏观数据、经济周期或跨资产基线变化', tone: 'medium' },
  policy: { label: '政策', detail: '偏监管、央行、政策口径与制度变化', tone: 'high' },
  sector: { label: '行业', detail: '偏产业链、主题、供需或板块联动', tone: 'medium' },
  company: { label: '个股', detail: '偏公司、财报、个股热度与经营层面催化', tone: 'high' },
  flow: { label: '资金', detail: '偏利率、汇率、竞拍与流动性再定价', tone: 'low' },
};

function minutesSince(timestamp: string) {
  return Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 60000));
}

export function getHeatShift(event: Event, baseline = BASELINE_FEVER) {
  return Number((event.feverLevel - baseline).toFixed(1));
}

export function getRelativeTimeLabel(timestamp: string) {
  const mins = minutesSince(timestamp);

  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;

  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

export function getFreshness(event: Event): { label: string; detail: string; tone: Tone } {
  const mins = minutesSince(event.timestamp);

  if (mins <= 90) {
    return { label: 'Fresh', detail: '最近 90 分钟内有新快照', tone: 'high' };
  }
  if (mins <= 360) {
    return { label: 'Active', detail: '今天内仍有可用信号', tone: 'medium' };
  }
  return { label: 'Aging', detail: '事件较旧，需要复核', tone: 'low' };
}

export function getSignalQuality(event: Event): { label: string; detail: string; tone: Tone } {
  const heatShift = Math.abs(getHeatShift(event));
  const assetScore = Math.min(event.impactAssets.length * 4, 12);
  const sourceScore = event.sourceUrl ? 8 : 0;
  const score = heatShift + assetScore + sourceScore;

  if (score >= 35) {
    return { label: 'High', detail: '热度偏离明显，且影响范围较清晰', tone: 'high' };
  }
  if (score >= 20) {
    return { label: 'Medium', detail: '有方向性，但仍需继续确认', tone: 'medium' };
  }
  return { label: 'Low', detail: '更像早期信号或局部噪音', tone: 'low' };
}

export function getEventType(event: Event): { key: EventTypeKey; label: string; detail: string; tone: Tone } {
  const text = `${event.title} ${event.description} ${event.impactAssets.join(' ')}`;

  if (/(财报|业绩|公司|股份|集团|个股|人气榜|股票|公告|回购|分红)/.test(text)) {
    return { key: 'company', ...EVENT_TYPE_META.company };
  }
  if (/(政策|监管|法案|制裁|关税|财政|降息|加息|决议|央行)/.test(text)) {
    return { key: 'policy', ...EVENT_TYPE_META.policy };
  }
  if (/(行业|板块|供应链|制造业|芯片|半导体|能源|地产|银行|科技|航运|工业)/.test(text)) {
    return { key: 'sector', ...EVENT_TYPE_META.sector };
  }
  if (/(收益率|汇率|国债|竞拍|M1|M2|流动性|资金|美元指数|债)/.test(text)) {
    return { key: 'flow', ...EVENT_TYPE_META.flow };
  }
  return { key: 'macro', ...EVENT_TYPE_META.macro };
}

export function getFraming(event: Event) {
  if (event.feverLevel >= 85) {
    return '危急扩散';
  }
  if (event.feverLevel >= 72) {
    return '意义明确';
  }
  if (event.feverLevel >= 60) {
    return '观察中';
  }
  return '低强度';
}

export function getMovementRead(event: Event) {
  const shift = getHeatShift(event);
  const freshness = getFreshness(event);

  if (shift >= 20) {
    return `高于基线 ${shift.toFixed(1)}° · ${freshness.label}`;
  }
  if (shift >= 8) {
    return `高于基线 ${shift.toFixed(1)}° · ${freshness.label}`;
  }
  if (shift <= -8) {
    return `低于基线 ${Math.abs(shift).toFixed(1)}° · ${freshness.label}`;
  }
  return `接近基线 · ${freshness.label}`;
}

export function getScenarioMatrix(event: Event) {
  const primaryAsset = event.impactAssets[0] || '风险资产';

  return [
    {
      title: '基准情景',
      tone: 'medium' as Tone,
      summary: `事件继续按当前节奏发酵，${primaryAsset} 延续方向性波动，但不会立刻演变成系统性风险。`,
    },
    {
      title: '上行扩散',
      tone: 'high' as Tone,
      summary: `若出现二次催化或更多市场跟随，热度可能继续上冲，${primaryAsset} 将成为第一轮传导目标。`,
    },
    {
      title: '回落修复',
      tone: 'low' as Tone,
      summary: '若后续信息没有继续强化，当前热度会向基线回归，事件会从主线降级为观察项。',
    },
  ];
}

export function getWatchPoints(event: Event) {
  const eventType = getEventType(event);
  const coreAssets = event.impactAssets.slice(0, 2).join(' / ') || '核心资产';

  if (eventType.key === 'policy') {
    return [
      `${event.market} 市场是否出现政策补充细则、执行时间或范围调整`,
      `${coreAssets} 是否在一个交易时段内出现同步方向变化`,
      event.sourceUrl ? '原始政策来源是否有修订、问答或二次确认' : '是否出现更高可信度的官方来源',
    ];
  }

  if (eventType.key === 'company') {
    return [
      `对应公司或可比公司是否出现进一步公告、澄清或资金异动`,
      `${coreAssets} 是否带动同主题公司形成扩散`,
      event.sourceUrl ? '原始消息链接是否补充更多业务或财务细节' : '是否能找到更高可信度的一手消息',
    ];
  }

  return [
    `${event.market} 市场是否在未来数小时继续出现同主题事件`,
    `${coreAssets} 是否出现同步方向变化`,
    event.sourceUrl ? '原始消息源是否出现补充细节或修订' : '是否出现更高可信度的外部来源',
  ];
}

export function findRelatedEvents(events: Event[], source: Event) {
  return events
    .filter((event) => event.id !== source.id)
    .map((event) => {
      const sharedAssets = event.impactAssets.filter((asset) => source.impactAssets.includes(asset)).length;
      const sameMarket = event.market === source.market ? 2 : 0;
      const score = sharedAssets * 3 + sameMarket + Math.abs(getHeatShift(event)) / 10;

      return { event, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => item.event);
}

export function getMarketSummary(events: Event[]) {
  return ['Global', 'US', 'EU', 'Asia'].map((market) => {
    const marketEvents = events.filter((event) => event.market === market);
    const avgFever =
      marketEvents.length > 0
        ? marketEvents.reduce((sum, event) => sum + event.feverLevel, 0) / marketEvents.length
        : 0;

    return {
      market,
      count: marketEvents.length,
      avgFever: Number(avgFever.toFixed(1)),
      topShift:
        marketEvents.length > 0
          ? Math.max(...marketEvents.map((event) => Math.abs(getHeatShift(event))))
          : 0,
    };
  });
}

export function getPriorityScore(event: Event, trackedAssets: string[] = []) {
  const freshness = getFreshness(event);
  const signal = getSignalQuality(event);
  const targetMatches = event.impactAssets.filter((asset) => trackedAssets.includes(asset)).length;
  const freshnessScore = freshness.tone === 'high' ? 12 : freshness.tone === 'medium' ? 7 : 3;
  const signalScore = signal.tone === 'high' ? 14 : signal.tone === 'medium' ? 9 : 4;
  return Number((Math.abs(getHeatShift(event)) + event.feverLevel * 0.4 + targetMatches * 10 + freshnessScore + signalScore).toFixed(1));
}

export function getEventMixSummary(events: Event[]) {
  const counts = new Map<EventTypeKey, { count: number; fever: number }>();

  events.forEach((event) => {
    const type = getEventType(event);
    const current = counts.get(type.key) ?? { count: 0, fever: 0 };
    counts.set(type.key, {
      count: current.count + 1,
      fever: current.fever + event.feverLevel,
    });
  });

  return (Object.keys(EVENT_TYPE_META) as EventTypeKey[])
    .map((key) => {
      const current = counts.get(key) ?? { count: 0, fever: 0 };
      return {
        key,
        label: EVENT_TYPE_META[key].label,
        detail: EVENT_TYPE_META[key].detail,
        count: current.count,
        avgFever: current.count > 0 ? Number((current.fever / current.count).toFixed(1)) : 0,
      };
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || b.avgFever - a.avgFever);
}

export function getResearchSummary(event: Event, trackedAssets: string[] = []) {
  const eventType = getEventType(event);
  const freshness = getFreshness(event);
  const signal = getSignalQuality(event);
  const targetMatches = event.impactAssets.filter((asset) => trackedAssets.includes(asset));
  const leadAsset = event.impactAssets[0] || '风险资产';

  return [
    `${eventType.label} · ${signal.label} · ${freshness.label}`,
    `先看 ${leadAsset}`,
    targetMatches.length > 0
      ? `命中 ${targetMatches.join(' / ')}`
      : `${event.market} 市场信号`,
  ];
}

export function getTransmissionSteps(event: Event) {
  const eventType = getEventType(event);
  const primaryAssets = event.impactAssets.slice(0, 2).join(' / ') || '核心资产';

  const middleStep =
    eventType.key === 'policy'
      ? `${event.market} 市场先通过监管预期与风险偏好重定价，把影响传导到 ${primaryAssets}。`
      : eventType.key === 'company'
        ? `公司层面催化先影响直接关联标的，再决定是否外溢到同主题与可比资产。`
        : eventType.key === 'sector'
          ? `产业链供需或主题叙事先在板块内部扩散，再观察是否升级为跨市场风格切换。`
          : eventType.key === 'flow'
            ? `利率、汇率或流动性变化会先改变定价锚，再扩散到权益与避险资产。`
            : `${event.market} 的宏观基线变化会先重估核心资产，再决定是否向更多板块扩散。`;

  return [
    {
      title: '触发源',
      detail: `事件标题为「${event.title}」，当前被归类为${eventType.label}事件。`,
    },
    {
      title: '第一轮传导',
      detail: middleStep,
    },
    {
      title: '验证节点',
      detail: `优先跟踪 ${primaryAssets} 与同市场后续事件是否在数小时内形成二次确认。`,
    },
  ];
}

export function getCounterSignals(event: Event) {
  const eventType = getEventType(event);

  if (eventType.key === 'policy') {
    return [
      '政策措辞强，但执行范围窄或落地时间偏后',
      '相关资产短线有反应，但同主题市场未跟随',
      '官方后续解释削弱了最初的市场想象空间',
    ];
  }

  if (eventType.key === 'company') {
    return [
      '个股热度上升，但成交与可比公司没有形成联动',
      '消息更多是情绪驱动，而非经营或财务变化',
      '后续公告没有补充关键细节，叙事难以延续',
    ];
  }

  return [
    '事件虽然出现，但相关资产没有形成一致方向',
    '后续同主题事件没有继续累积，热度快速回落',
    '更高可信度来源没有补充增量事实，事件可能只是噪音',
  ];
}
