import { useFeverStore } from '../store';

const QVERIS_API_KEY = process.env.QVERIS_API_KEY;
const QVERIS_BASE_URL = process.env.QVERIS_BASE_URL?.replace(/"/g, '') || "https://qveris.ai/api/v1";
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL?.replace(/"/g, '') || "deepseek-v4-flash";

async function fetchFreeMarketEvent(market: string) {
  const endpoint = `/api/live/free-event?market=${encodeURIComponent(market)}`;
  useFeverStore.getState().addLog({
    type: 'request',
    source: 'AKShare',
    data: { endpoint, market }
  });

  const res = await fetch(endpoint);
  if (!res.ok) {
    const errText = await res.text();
    useFeverStore.getState().addLog({
      type: 'error',
      source: 'AKShare',
      data: { status: res.status, error: errText }
    });
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  useFeverStore.getState().addLog({
    type: 'response',
    source: 'AKShare',
    data
  });
  return data.event;
}

export async function fetchFreeMarketEvents(market: string, limit = 6) {
  const endpoint = `/api/live/free-events?market=${encodeURIComponent(market)}&limit=${encodeURIComponent(limit)}`;
  useFeverStore.getState().addLog({
    type: 'request',
    source: 'AKShare',
    data: { endpoint, market, limit }
  });

  const res = await fetch(endpoint);
  if (!res.ok) {
    const errText = await res.text();
    useFeverStore.getState().addLog({
      type: 'error',
      source: 'AKShare',
      data: { status: res.status, error: errText }
    });
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  useFeverStore.getState().addLog({
    type: 'response',
    source: 'AKShare',
    data
  });
  return Array.isArray(data.events) ? data.events : [];
}

export async function askLLM(
  systemPrompt: string,
  userPrompt: string,
  options: { allowQVerisFallback?: boolean } = {},
) {
  let model = LLM_MODEL.split(' ')[0]; // remove comments like "# deepseek-v4"
  const allowQVerisFallback = options.allowQVerisFallback ?? true;

  const tryFetch = async (endpoint: string, key: string, source: 'LLM' | 'QVeris') => {
    const payload = {
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    };
    
    useFeverStore.getState().addLog({
      type: 'request',
      source: source,
      data: { endpoint, payload }
    });

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
      const errText = await res.text();
      useFeverStore.getState().addLog({
        type: 'error',
        source: source,
        data: { status: res.status, error: errText }
      });
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }
    return res;
  };

  let res;
  let usedSource: 'LLM' | 'QVeris' = 'LLM';
  try {
    if (!LLM_API_KEY) throw new Error("No LLM Key");
    res = await tryFetch('/api/llm/chat/completions', LLM_API_KEY, 'LLM');
  } catch (err1) {
    if (!allowQVerisFallback) {
      throw err1;
    }
    console.warn("Primary LLM API failed, trying QVeris...", err1);
    try {
      usedSource = 'QVeris';
      res = await tryFetch('/api/qveris/chat/completions', QVERIS_API_KEY!, 'QVeris');
    } catch (err2) {
      console.error("Both LLM APIs failed.");
      useFeverStore.getState().addLog({
        type: 'error',
        source: 'LLM',
        data: { error: 'Both LLM and QVeris APIs failed.' }
      });
      throw err2;
    }
  }

  const data = await res.json();
  
  useFeverStore.getState().addLog({
    type: 'response',
    source: usedSource,
    data: data
  });
  let content = data.choices[0].message.content;
  
  try {
    // 去除 markdown 块
    content = content.trim();
    if (content.startsWith("```")) {
      const jsonMatch = content.match(/```(?:json)?\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        content = jsonMatch[1];
      } else {
        // Fallback for poorly formatted markdown blocks
        content = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
    }
    return JSON.parse(content);
  } catch (e) {
    console.error("Failed to parse LLM JSON response:", content);
    throw e;
  }
}

export async function generateMarketEvent(market: string, _currentGlobalFever: number, _language: string = 'zh') {
  try {
    return await fetchFreeMarketEvent(market);
  } catch (freeDataErr) {
    console.warn("AKShare event fetch failed, skipping synthetic event generation:", freeDataErr);
    throw freeDataErr;
  }
}

export async function predictGraphDownstream(sourceNode: any, scenario: string, activeMarket: string, targetAssets: string[]) {
  try {
    const sys = `You are a risk simulation engine for a cyber-finance dashboard. A financial node is being analyzed under a "${scenario}" scenario in the ${activeMarket} market. Return ONLY valid JSON format without any additional text. IMPORTANT: All output text values (labels, reasoning, etc) MUST be in Chinese.`;
    
    const assetFocus = targetAssets && targetAssets.length > 0 
      ? `CRITICAL: The user is specifically monitoring these target assets: ${targetAssets.join(', ')}. You MUST include at least one of these specific assets in your downstream predictions and analyze how the source event impacts them.`
      : `Make sure AT LEAST ONE of the generated nodes is a specific financial asset (category: "asset") such as a stock ticker, currency pair, or commodity.`;

    const prompt = `Source node data: 
    - Label: ${sourceNode.label}
    - Fever: ${sourceNode.fever}/100
    - Category: ${sourceNode.category}

    Generate 2 realistic downstream impacted nodes and the edges connecting from the source to them.
    ${assetFocus}
    
    For assets, include a "trend" field indicating its price direction.
    JSON format:
    {
      "newNodes": [
        { "label": "Impact Name (Chinese)", "category": "macro" | "asset" | "indicator" | "event", "fever": <number 0-100>, "market": "${activeMarket}", "reasoning": "A short 1-sentence explanation of why this happens (Chinese)", "trend": "bullish" | "bearish" | "neutral" }
      ],
      "newEdges": [
        { "targetLabel": "Impact Name (Chinese)", "relation": "Short Verb (e.g., Triggers, Crashes - in Chinese)", "probability": <float 0.1 to 0.99> }
      ]
    }`;
    
    return await askLLM(sys, prompt);
  } catch (err) {
    console.warn("LLM prediction failed, using fallback data for predictGraphDownstream:", err);
    
    const targetAsset = (targetAssets && targetAssets.length > 0) ? targetAssets[0] : "避险资产";
    
    return {
      newNodes: [
        { label: targetAsset, category: "asset", fever: sourceNode.fever + 5, market: activeMarket, reasoning: `由于${scenario}预期导致的资金流动`, trend: scenario === 'bull' ? "bullish" : "bearish" },
        { label: "行业供应链", category: "macro", fever: sourceNode.fever - 2, market: activeMarket, reasoning: "成本传导与预期调整", trend: "neutral" }
      ],
      newEdges: [
        { targetLabel: targetAsset, relation: "波及", probability: 0.85 },
        { targetLabel: "行业供应链", relation: "传导", probability: 0.65 }
      ]
    };
  }
}

export async function generateDeepDiveReport(nodeData: any) {
  const sys = `You are an elite quantitative AI analyst in a cyber-finance system. Provide a highly professional, deep-dive analytical report on the provided financial node. Output strictly in JSON format. IMPORTANT: All output text values MUST be in Chinese, except for enum values.`;
  const prompt = `Target Node:
  - Name: ${nodeData.label}
  - Category: ${nodeData.category}
  - Severity/Fever: ${nodeData.fever}/100
  - Market: ${nodeData.market}
  - Context/Reasoning: ${nodeData.reasoning || 'N/A'}

  Provide a JSON response with the following structure:
  {
    "summary": "A concise executive summary of the situation (2-3 sentences in Chinese)",
    "marketSentiment": "Bearish" | "Bullish" | "Highly Volatile" | "Panic" (keep this in English),
    "keyDrivers": ["Driver 1", "Driver 2", "Driver 3"] (in Chinese),
    "assetImplications": [
      { "asset": "Ticker or Asset Class", "impact": "Positive" | "Negative" | "Mixed" (keep this in English), "rationale": "Why? (in Chinese)" }
    ],
    "systemicRiskLevel": "Low" | "Medium" | "High" | "Critical" (keep this in English)
  }`;

  return await askLLM(sys, prompt);
}
