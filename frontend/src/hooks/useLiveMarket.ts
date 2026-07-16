import { useEffect, useRef } from 'react';
import { useFeverStore, Event } from '../store';
import { buildStableEventId, normalizeEventTimestamp } from '../lib/eventIdentity';
import { generateMarketEvent } from '../services/llm';

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
          eventData = await generateMarketEvent(mkt, globalFever);
        } catch (apiErr) {
          console.warn("Free market event fetch failed, skipping live event update.", apiErr);
          return;
        }
        
        const timestamp = normalizeEventTimestamp(eventData.timestamp);
        const newEvent: Event = {
          id: buildStableEventId({
            title: eventData.title,
            desc: eventData.desc,
            assets: eventData.assets,
            sourceUrl: eventData.sourceUrl,
            market: mkt,
            timestamp,
          }, 'evt-live'),
          title: eventData.title,
          feverLevel: Number(eventData.baseFever.toFixed(1)),
          timestamp,
          impactAssets: eventData.assets,
          description: eventData.desc,
          market: mkt,
          sourceUrl: eventData.sourceUrl,
          provider: eventData.provider,
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
      const decision = Math.random();
      if (decision > 0.7) {
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
