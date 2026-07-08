import { useEffect, useRef } from 'react';
import { useFeverStore, Event } from '../store';
import { generateMarketEvent } from '../services/llm';

const TEMPLATES = [
  { title: 'Unexpected Inflation Print in {market}', desc: 'Core CPI exceeds expectations, raising fears of extended tight monetary policy.', assets: ['Bonds', 'Equities', 'USD'], baseFever: 75 },
  { title: 'Central Bank in {market} Signals Dovish Pivot', desc: 'Policymakers hint at potential rate cuts in the upcoming quarter.', assets: ['Currency', 'Equities', 'Gold'], baseFever: 65 },
  { title: 'Major Supply Chain Disruption in {market}', desc: 'Logistics gridlock at major ports causes immediate shortages.', assets: ['Commodities', 'Industrials'], baseFever: 82 },
  { title: 'Flash Crash in {market} Tech Sector', desc: 'Algorithmic selling triggers rapid and unexplained drops across tech blue-chips.', assets: ['Tech', 'Derivatives'], baseFever: 90 },
];

const MARKETS = ['US', 'EU', 'Asia', 'Global'] as const;

export function useLiveMarket() {
  const { addEvent, globalFever, updateGlobalFever, isLive, activeMarket } = useFeverStore();
  const isGenerating = useRef(false);

  useEffect(() => {
    if (!isLive) return;

    const generateAsync = async () => {
      if (isGenerating.current) return;
      isGenerating.current = true;
      try {
        const mkt = activeMarket;
        
        let eventData;
        try {
          // Attempt real API generation
          eventData = await generateMarketEvent(mkt, globalFever);
        } catch (apiErr) {
          console.warn("LLM Event Generation Failed, falling back to templates.", apiErr);
          const template = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
          const noise = Math.random() * 20 - 10;
          eventData = {
            title: template.title.replace('{market}', mkt),
            desc: template.desc,
            assets: template.assets,
            baseFever: Math.min(100, Math.max(0, template.baseFever + noise))
          };
        }
        
        const newEvent: Event = {
          id: `evt-live-${Date.now()}`,
          title: eventData.title,
          feverLevel: Number(eventData.baseFever.toFixed(1)),
          timestamp: new Date().toISOString(),
          impactAssets: eventData.assets,
          description: eventData.desc,
          market: mkt,
          sourceUrl: eventData.sourceUrl || 'https://www.reuters.com/markets'
        };
        
        addEvent(newEvent);
        
        const shiftFactor = eventData.baseFever > 80 ? 0.15 : 0.05;
        const newGlobalFever = globalFever + (eventData.baseFever - globalFever) * shiftFactor;
        updateGlobalFever(Math.min(100, Math.max(0, Number(newGlobalFever.toFixed(1)))));
      } finally {
        isGenerating.current = false;
      }
    };

    const interval = setInterval(() => {
      // 30% chance to generate an event every 10 seconds (reduces API load)
      if (Math.random() > 0.7) {
        generateAsync();
      } else {
        // Natural mean reversion
        if (globalFever > 60) {
          updateGlobalFever(Math.max(60, Number((globalFever - 0.5).toFixed(1))));
        } else if (globalFever < 60) {
          updateGlobalFever(Math.min(60, Number((globalFever + 0.5).toFixed(1))));
        }
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [addEvent, globalFever, updateGlobalFever, isLive, activeMarket]);
}