import { create } from 'zustand';
import { buildStableEventId, normalizeEventTimestamp } from '../lib/eventIdentity';
import { fetchFreeMarketEvents, generateMarketEvent } from '../services/llm';

export interface Event {
  id: string;
  title: string;
  feverLevel: number; // 0 to 100
  timestamp: string;
  impactAssets: string[];
  description: string;
  market: 'Global' | 'US' | 'EU' | 'Asia';
  sourceUrl?: string;
  provider?: string;
}

export interface GraphNode {
  id: string;
  label: string;
  category: 'event' | 'asset' | 'macro' | 'indicator' | 'company';
  fever: number;
  position?: { x: number; y: number };
  status: 'historical' | 'predicted';
  timestamp: string;
  market: 'Global' | 'US' | 'EU' | 'Asia';
  reasoning?: string;
  sourceUrl?: string;
  trend?: 'bullish' | 'bearish' | 'neutral'; // Added for asset trend tracking
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  probability: number;
}

export interface GraphSession {
  id: string;
  title: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  sourceEventId?: string;
}

export interface SystemLog {
  id: string;
  timestamp: string;
  type: 'request' | 'response' | 'error';
  source: 'LLM' | 'QVeris' | 'Argus' | 'AKShare';
  data: any;
}

interface FeverStore {
  events: Event[];
  sessions: GraphSession[];
  logs: SystemLog[];
  activeSessionId: string | null;
  globalFever: number;
  selectedNodeId: string | null;
  activeMarket: 'Global' | 'US' | 'EU' | 'Asia';
  isLive: boolean;
  language: 'zh' | 'en';
  targetAssets: string[]; // New state for target assets
  addEvent: (event: Event) => void;
  updateGlobalFever: (level: number) => void;
  updateNodeFever: (id: string, fever: number) => void;
  setSelectedNodeId: (id: string | null) => void;
  setActiveMarket: (market: 'Global' | 'US' | 'EU' | 'Asia') => void;
  setLanguage: (lang: 'zh' | 'en') => void;
  addTargetAsset: (asset: string) => void;
  removeTargetAsset: (asset: string) => void;
  toggleLive: () => void;
  createSessionFromEvent: (event: Event) => void;
  setActiveSession: (id: string) => void;
  addElementsToActiveSession: (newNodes: GraphNode[], newEdges: GraphEdge[]) => void;
  addLog: (log: Omit<SystemLog, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
  initializeSystem: () => Promise<void>;
  reloadFreeEvents: () => Promise<void>;
  isInitializing: boolean;
  freeSourceStatus: 'idle' | 'ready' | 'empty';
  freeSourceMessage: string | null;
}

let initializationPromise: Promise<void> | null = null;

const MOCK_EVENTS: Event[] = [];

const MOCK_NODES: GraphNode[] = [
  { id: 'n1', label: 'AI算力芯片短缺', category: 'macro', fever: 88, position: { x: 250, y: 200 }, status: 'historical', timestamp: new Date().toISOString(), market: 'Global' },
  { id: 'n2', label: 'TSM (台积电)', category: 'company', fever: 75, position: { x: 500, y: 100 }, status: 'historical', timestamp: new Date().toISOString(), market: 'Asia' },
  { id: 'n3', label: 'NVDA (英伟达)', category: 'company', fever: 92, position: { x: 500, y: 250 }, status: 'historical', timestamp: new Date().toISOString(), market: 'US' },
  { id: 'n4', label: '半导体ETF (SMH)', category: 'asset', fever: 80, position: { x: 750, y: 180 }, status: 'historical', timestamp: new Date().toISOString(), market: 'US', trend: 'bullish' },
  { id: 'n5', label: '高带宽内存 (HBM) 价格飙升', category: 'indicator', fever: 85, position: { x: 250, y: 350 }, status: 'historical', timestamp: new Date().toISOString(), market: 'Asia' },
  { id: 'n6', label: 'SK Hynix', category: 'company', fever: 78, position: { x: 500, y: 400 }, status: 'historical', timestamp: new Date().toISOString(), market: 'Asia' },
  { id: 'n7', label: '电力基建需求激增', category: 'macro', fever: 65, position: { x: 750, y: 350 }, status: 'historical', timestamp: new Date().toISOString(), market: 'Global' }
];

const MOCK_EDGES: GraphEdge[] = [
  { id: 'e1', source: 'n1', target: 'n2', relation: '产能挤压', probability: 0.9 },
  { id: 'e2', source: 'n1', target: 'n3', relation: '供给受限', probability: 0.95 },
  { id: 'e3', source: 'n2', target: 'n4', relation: '权重波及', probability: 0.8 },
  { id: 'e4', source: 'n3', target: 'n4', relation: '高度正相关', probability: 0.85 },
  { id: 'e5', source: 'n5', target: 'n1', relation: '核心瓶颈', probability: 0.75 },
  { id: 'e6', source: 'n6', target: 'n5', relation: '垄断供应', probability: 0.88 },
  { id: 'e7', source: 'n3', target: 'n7', relation: '数据中心能耗', probability: 0.70 }
];

const DEFAULT_SESSION: GraphSession = {
  id: 's-default',
  title: 'Global Macro Baseline',
  nodes: MOCK_NODES,
  edges: MOCK_EDGES,
};

function extractErrorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return typeof reason === 'string' ? reason : '免费事件源暂时不可用';
}

function buildFreeSourceMessage(events: Event[], errors: string[]): string | null {
  const snapshotMarkets = Array.from(
    new Set(
      events
        .filter((event) => event.provider === 'free_snapshot')
        .map((event) => event.market),
    ),
  );

  if (snapshotMarkets.length > 0) {
    return `部分实时免费源波动，当前已切换到免费快照：${snapshotMarkets.join(' / ')}。`;
  }

  if (events.length === 0) {
    return '当前实时免费源暂不可用，请稍后重试。';
  }

  if (errors.length > 0) {
    return '部分市场拉取波动，但当前已有可用的免费事件。';
  }

  return null;
}

function dedupeEvents(events: Event[]): Event[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.id)) {
      return false;
    }
    seen.add(event.id);
    return true;
  });
}

export const useFeverStore = create<FeverStore>((set, get) => ({
  events: MOCK_EVENTS,
  sessions: [DEFAULT_SESSION],
  logs: [],
  activeSessionId: 's-default',
  globalFever: 65,
  selectedNodeId: null,
  activeMarket: 'Asia',
  isLive: true,
  language: 'zh',
  targetAssets: [],
  isInitializing: true,
  freeSourceStatus: 'idle',
  freeSourceMessage: null,
  addEvent: (event) => set((state) => {
    return { events: [event, ...state.events].slice(0, 50) };
  }),
  updateGlobalFever: (level) => set({ globalFever: level }),
  updateNodeFever: (id, fever) => set((state) => ({
    sessions: state.sessions.map(s => s.id === state.activeSessionId ? {
      ...s,
      nodes: s.nodes.map(n => n.id === id ? { ...n, fever } : n)
    } : s)
  })),
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  setActiveMarket: (market) => set({ activeMarket: market }),
  setLanguage: (lang) => set({ language: lang }),
  addTargetAsset: (asset) => set((state) => ({ targetAssets: Array.from(new Set([...state.targetAssets, asset])) })),
  removeTargetAsset: (asset) => set((state) => ({ targetAssets: state.targetAssets.filter(a => a !== asset) })),
  toggleLive: () => set((state) => ({ isLive: !state.isLive })),
  createSessionFromEvent: (event) => set((state) => {
    // If session already exists for this event, just switch to it
    const existing = state.sessions.find(s => s.id === `s-${event.id}`);
    if (existing) {
      return { activeSessionId: existing.id, selectedNodeId: null };
    }
    
    const newSession: GraphSession = {
      id: `s-${event.id}`,
      title: event.title,
      sourceEventId: event.id,
      nodes: [{
        id: `root-${event.id}`,
        label: event.title,
        category: 'event',
        fever: event.feverLevel,
        position: { x: 50, y: 300 }, // Ensure it starts on the left with some space
        status: 'historical',
        timestamp: event.timestamp,
        market: event.market,
        sourceUrl: event.sourceUrl
      }],
      edges: []
    };
    return {
      sessions: [newSession, ...state.sessions],
      activeSessionId: newSession.id,
      selectedNodeId: null
    };
  }),
  setActiveSession: (id) => set({ activeSessionId: id, selectedNodeId: null }),
  addElementsToActiveSession: (newNodes, newEdges) => set((state) => ({
    sessions: state.sessions.map(s => s.id === state.activeSessionId ? {
      ...s,
      nodes: [...s.nodes, ...newNodes],
      edges: [...s.edges, ...newEdges]
    } : s)
  })),
  addLog: (log) => set((state) => ({
    logs: [...state.logs, { ...log, id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`, timestamp: new Date().toISOString() }].slice(-100) // Keep last 100 logs
  })),
  clearLogs: () => set({ logs: [] }),
  reloadFreeEvents: async () => {
    set({ isInitializing: true, freeSourceMessage: null });
    return get().initializeSystem();
  },
  
  initializeSystem: async () => {
    if (initializationPromise) {
      return initializationPromise;
    }

    initializationPromise = (async () => {
      try {
      const { language } = get();
      const markets: Array<'US' | 'Global' | 'EU' | 'Asia'> = ['Asia', 'US', 'EU', 'Global'];
      const initEvents: Event[] = [];
      const initNodes: GraphNode[] = [];
      const errors: string[] = [];
      
      // 并行请求获取初始事件列表
      const promises = markets.map((m) => fetchFreeMarketEvents(m, 6));
      const results = await Promise.allSettled(promises);
      
      results.forEach((res, idx) => {
        if (res.status === 'fulfilled' && res.value.length > 0) {
          const mkt = markets[idx];
          const marketEvents = res.value.map((item, itemIdx) => {
            const timestamp = normalizeEventTimestamp(item.timestamp);
            return {
              id: buildStableEventId({
                title: item.title,
                desc: item.desc,
                assets: item.assets,
                sourceUrl: item.sourceUrl,
                market: mkt,
                timestamp,
              }),
              title: item.title || 'Market Update',
              description: item.desc || 'Free market event.',
              feverLevel: Number((item.baseFever || 60).toFixed(1)),
              impactAssets: item.assets || [],
              market: mkt,
              timestamp,
              sourceUrl: item.sourceUrl,
              provider: item.provider,
              _order: itemIdx,
            };
          });

          marketEvents.forEach((evt, itemIdx) => {
            initEvents.push(evt);
            if (itemIdx === 0) {
              initNodes.push({
                id: `n-init-${idx}`,
                label: evt.title,
                category: 'macro',
                fever: evt.feverLevel,
                position: { x: 100, y: 150 + idx * 220 },
                status: 'historical',
                timestamp: evt.timestamp,
                market: mkt,
                sourceUrl: evt.sourceUrl
              });
            }
          });
        }
        if (res.status === 'rejected') {
          errors.push(`${markets[idx]}: ${extractErrorMessage(res.reason)}`);
        }
      });
      
      if (initEvents.length > 0) {
        const normalizedEvents = dedupeEvents(initEvents)
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 32);
        set({ 
          events: normalizedEvents,
          sessions: [{
            id: 's-default',
            title: 'Global Baseline',
            nodes: initNodes,
            edges: []
          }],
          globalFever: normalizedEvents[0]?.feverLevel ?? 60,
          isInitializing: false,
          freeSourceStatus: 'ready',
          freeSourceMessage: buildFreeSourceMessage(normalizedEvents, errors),
        });
      } else {
        set({
          events: [],
          isInitializing: false,
          freeSourceStatus: 'empty',
          freeSourceMessage: buildFreeSourceMessage(initEvents, errors),
        });
      }
      } catch (e) {
        console.error("Initialization failed", e);
        set({
          events: [],
          isInitializing: false,
          freeSourceStatus: 'empty',
          freeSourceMessage: '当前实时免费源暂不可用，请稍后重试。',
        });
      } finally {
        initializationPromise = null;
      }
    })();

    return initializationPromise;
  }
}));
