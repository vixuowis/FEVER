import type { Event } from '../store';

const BASELINE_FEVER = 60;

type Tone = 'high' | 'medium' | 'low';

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
  const quality = getSignalQuality(event);

  if (shift >= 20) {
    return `该事件较系统基线抬升 ${shift.toFixed(1)}°，当前属于高热度冲击。${freshness.detail}，${quality.detail}。`;
  }
  if (shift >= 8) {
    return `该事件较系统基线抬升 ${shift.toFixed(1)}°，说明市场已经形成明确关注。${freshness.detail}，${quality.detail}。`;
  }
  if (shift <= -8) {
    return `该事件低于系统基线 ${Math.abs(shift).toFixed(1)}°，当前更像局部议题或衰减中的旧信号。${freshness.detail}。`;
  }
  return `该事件与系统基线接近，说明市场尚未形成一致定价。${freshness.detail}，建议结合相关资产和后续事件继续观察。`;
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
  return [
    `${event.market} 市场是否在未来数小时继续出现同主题事件`,
    `${event.impactAssets.slice(0, 2).join(' / ') || '核心资产'} 是否出现同步方向变化`,
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
