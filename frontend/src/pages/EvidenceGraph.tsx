import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Panel,
  MarkerType
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { clsx } from 'clsx';
import { Activity, Play, RefreshCw, FileText, CheckCircle2, AlertCircle, HelpCircle, GitMerge, Trash2 } from 'lucide-react';
import { useFeverStore } from '../store';

const API_BASE = `${window.location.protocol}//${window.location.hostname}:7860/api`;

interface RunInfo {
  run_id: string;
  run_dir: string;
  mtime: number;
  has_answer: boolean;
  has_eval: boolean;
}

// QVeris API Mock Generator
const getQVerisMockRuns = (): RunInfo[] => [
  {
    run_id: 'qveris_case_tsla_2026',
    run_dir: '/qveris/tsla',
    mtime: Date.now() / 1000 - 3600,
    has_answer: true,
    has_eval: true
  },
  {
    run_id: 'qveris_case_crypto_reg',
    run_dir: '/qveris/crypto',
    mtime: Date.now() / 1000 - 86400,
    has_answer: true,
    has_eval: false
  }
];

const getQVerisMockDetails = (runId: string) => {
  useFeverStore.getState().addLog({
    type: 'request',
    source: 'QVeris',
    data: { endpoint: `/api/v1/search`, params: { runId } }
  });

  let mockGraph: any = null;

  if (runId === 'qveris_case_tsla_2026') {
    mockGraph = {
      question: "Will TSLA announce a successful solid-state battery breakthrough in Q3 2026?",
      final_answer: { answer: "Based on recent patent filings and supply chain movements, TSLA is highly likely to announce a breakthrough, but mass production will be delayed to 2027." },
      claim_nodes: [
        { id: 'c1', claim: 'TSLA has filed 3 new patents related to solid-state electrolytes in Q1.', status: 'supported', confidence: 0.95 },
        { id: 'c2', claim: 'Panasonic has halted pilot line equipment delivery.', status: 'contradicted', confidence: 0.88 },
        { id: 'c3', claim: 'Competitors like Toyota are 2 years ahead.', status: 'supported', confidence: 0.75 }
      ],
      evidence_nodes: [
        { id: 'e1', text: 'USPTO Patent #1122334 filed by Tesla Inc. on solid-state separator membranes.', source_url: 'https://pure.warrenq.com/docs/uspto/1122334' },
        { id: 'e2', text: 'Supply chain insider reports Panasonic accelerating equipment delivery to Nevada gigafactory.', source_url: 'https://qveris.ai/detail/supply-chain/tsla-panasonic' },
        { id: 'e3', text: 'Toyota officially announces solid-state EVs rolling out in late 2027, missing their 2025 target.', source_url: 'https://qveris.ai/detail/news/toyota-ssb' }
      ],
      edges: [
        { id: 'edge1', from_id: 'e1', to_id: 'c1', relation: 'support' },
        { id: 'edge2', from_id: 'e2', to_id: 'c2', relation: 'contradict' },
        { id: 'edge3', from_id: 'e3', to_id: 'c3', relation: 'contradict' }
      ]
    };
  } else if (runId === 'qveris_case_crypto_reg') {
    mockGraph = {
      question: "How does recent regulation affect the crypto market?",
      final_answer: { answer: "Recent regulations have introduced strict compliance requirements for exchanges, leading to short-term market volatility but potentially higher long-term institutional adoption." },
      claim_nodes: [
        { id: 'c1', claim: 'Strict compliance requirements introduced for major exchanges.', status: 'supported', confidence: 0.95 },
        { id: 'c2', claim: 'Short-term market volatility increased by 15%.', status: 'supported', confidence: 0.88 },
        { id: 'c3', claim: 'Institutional adoption will decrease permanently.', status: 'contradicted', confidence: 0.92 }
      ],
      evidence_nodes: [
        { id: 'e1', text: 'SEC announces new framework requiring full KYC/AML compliance for all tier-1 crypto exchanges within 90 days.', source_url: 'https://sec.gov/news/press-release' },
        { id: 'e2', text: 'Bitcoin price drops 8% following the regulatory announcement, while trading volume spikes across decentralized platforms.', source_url: 'https://coindesk.com/market-update' },
        { id: 'e3', text: 'BlackRock and Fidelity signal that clear regulations are the exact catalyst needed for their crypto ETF expansions.', source_url: 'https://bloomberg.com/crypto-institutional' }
      ],
      edges: [
        { id: 'edge1', from_id: 'e1', to_id: 'c1', relation: 'support' },
        { id: 'edge2', from_id: 'e2', to_id: 'c2', relation: 'support' },
        { id: 'edge3', from_id: 'e3', to_id: 'c3', relation: 'contradict' }
      ]
    };
  }

  useFeverStore.getState().addLog({
    type: 'response',
    source: 'QVeris',
    data: mockGraph
  });

  return mockGraph;
};

export default function EvidenceGraph() {
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // New Job state
  const [question, setQuestion] = useState('How does recent regulation affect the crypto market?');
  const [startingJob, setStartingJob] = useState(false);

  useEffect(() => {
    fetchRuns();
  }, []);

  const fetchRuns = async () => {
    try {
      useFeverStore.getState().addLog({ type: 'request', source: 'Argus', data: { endpoint: '/api/runs' } });
      const res = await fetch(`${API_BASE}/runs`);
      const data = await res.json();
      useFeverStore.getState().addLog({ type: 'response', source: 'Argus', data: data });
      
      // Mix QVeris simulated runs into the API data
      const qverisRuns = getQVerisMockRuns();
      let allRuns = [];
      
      if (data.runs && data.runs.length > 0) {
        allRuns = [...data.runs, ...qverisRuns];
      } else {
        allRuns = qverisRuns;
      }
      
      setRuns(allRuns);
      if (allRuns.length > 0 && !selectedRunId) {
        setSelectedRunId(allRuns[0].run_id);
      }
    } catch (e: any) {
      console.error('Failed to fetch runs, falling back to mock:', e);
      useFeverStore.getState().addLog({ type: 'error', source: 'Argus', data: { endpoint: '/api/runs', error: e.message } });
      const fallbackRuns = getQVerisMockRuns();
      setRuns(fallbackRuns);
      if (!selectedRunId) {
        setSelectedRunId(fallbackRuns[0].run_id);
      }
    }
  };

  const fetchRunDetails = async (runId: string) => {
    setLoading(true);
    
    // Check if it's a QVeris mock run
    if (runId.startsWith('qveris_case_')) {
      const mockGraph = getQVerisMockDetails(runId);
      setTimeout(() => {
        setGraphData({ graph: mockGraph, question: mockGraph.question, final_answer: mockGraph.final_answer });
        buildReactFlowGraph(mockGraph);
        setLoading(false);
      }, 500);
      return;
    }

    try {
      useFeverStore.getState().addLog({ type: 'request', source: 'Argus', data: { endpoint: `/api/runs/${runId}` } });
      const res = await fetch(`${API_BASE}/runs/${runId}`);
      const data = await res.json();
      useFeverStore.getState().addLog({ type: 'response', source: 'Argus', data: data });
      setGraphData(data);
      if (data.graph) {
        buildReactFlowGraph(data.graph);
      } else {
        setNodes([]);
        setEdges([]);
      }
    } catch (e: any) {
      console.error('Failed to fetch run details:', e);
      useFeverStore.getState().addLog({ type: 'error', source: 'Argus', data: { endpoint: `/api/runs/${runId}`, error: e.message } });
    } finally {
      setLoading(false);
    }
  };

  const deleteRun = (runId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRuns(runs.filter(r => r.run_id !== runId));
    if (selectedRunId === runId) {
      setSelectedRunId(null);
      setGraphData(null);
      setNodes([]);
      setEdges([]);
    }
  };

  const startJob = async () => {
    if (!question.trim()) return;
    setStartingJob(true);
    try {
      const payload = { question, k: 3, max_rounds: 3 };
      useFeverStore.getState().addLog({ type: 'request', source: 'Argus', data: { endpoint: '/api/jobs', payload } });
      const res = await fetch(`${API_BASE}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        useFeverStore.getState().addLog({ type: 'response', source: 'Argus', data: { status: 'Job started' } });
        alert('Job started successfully! It will appear in the runs list shortly.');
        setTimeout(fetchRuns, 3000);
      } else {
        const errText = await res.text();
        useFeverStore.getState().addLog({ type: 'error', source: 'Argus', data: { endpoint: '/api/jobs', status: res.status, error: errText } });
      }
    } catch (e: any) {
      console.error('Failed to start job:', e);
      useFeverStore.getState().addLog({ type: 'error', source: 'Argus', data: { endpoint: '/api/jobs', error: e.message } });
    } finally {
      setStartingJob(false);
    }
  };

  useEffect(() => {
    if (selectedRunId) {
      fetchRunDetails(selectedRunId);
    }
  }, [selectedRunId]);

  const buildReactFlowGraph = useCallback((graph: any) => {
    const newNodes: any[] = [];
    const newEdges: any[] = [];
    let yOffset = 0;
    
    // Layout Claims (Left Side)
    const claims = graph.claim_nodes || [];
    claims.forEach((claim: any, idx: number) => {
      newNodes.push({
        id: claim.id,
        type: 'default',
        position: { x: 250, y: yOffset },
        data: {
          label: (
            <div className="flex flex-col gap-2 p-2">
              <div className="flex items-center gap-2">
                {claim.status === 'supported' ? <CheckCircle2 className="w-4 h-4 text-green-500" /> :
                 claim.status === 'contradicted' ? <AlertCircle className="w-4 h-4 text-red-500" /> :
                 <HelpCircle className="w-4 h-4 text-yellow-500" />}
                <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Claim</span>
              </div>
              <div className="text-sm font-medium text-gray-200">{claim.claim}</div>
              {claim.confidence > 0 && (
                <div className="text-[10px] text-gray-500 mt-1">Confidence: {(claim.confidence * 100).toFixed(0)}%</div>
              )}
            </div>
          )
        },
        style: {
          background: '#0a0a0a',
          border: `1px solid ${claim.status === 'supported' ? '#22c55e' : claim.status === 'contradicted' ? '#ef4444' : '#eab308'}`,
          borderRadius: '8px',
          width: 280,
          color: '#fff'
        }
      });
      yOffset += 150;
    });

    // Layout Evidence (Right Side)
    let evYOffset = 0;
    const evidences = graph.evidence_nodes || [];
    evidences.forEach((ev: any, idx: number) => {
      newNodes.push({
        id: ev.id,
        type: 'default',
        position: { x: 800, y: evYOffset },
        data: {
          label: (
            <div className="flex flex-col gap-2 p-2">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-blue-400">Evidence</span>
              </div>
              <div className="text-xs text-gray-300 line-clamp-3">{ev.text}</div>
              <div className="text-[10px] text-gray-500 truncate mt-1">{ev.source_url}</div>
            </div>
          )
        },
        style: {
          background: '#050505',
          border: '1px solid #1e3a8a',
          borderRadius: '8px',
          width: 320,
          color: '#fff'
        }
      });
      evYOffset += 180;
    });

    // Create Edges
    const edgesList = graph.edges || [];
    edgesList.forEach((e: any) => {
      const isSupport = e.relation === 'support';
      newEdges.push({
        id: e.id,
        source: e.from_id,
        target: e.to_id,
        animated: true,
        label: e.relation,
        labelStyle: { fill: '#9ca3af', fontSize: 10, fontWeight: 600 },
        labelBgStyle: { fill: '#0a0a0a' },
        style: { stroke: isSupport ? '#22c55e' : '#ef4444', strokeWidth: 2 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isSupport ? '#22c55e' : '#ef4444',
        },
      });
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [setNodes, setEdges]);

  return (
    <div className="h-full flex flex-col gap-6">
      <div className="flex justify-between items-end border-b border-gray-800 pb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-100">Argus Evidence Graph</h1>
          <p className="text-sm text-gray-400 mt-2">
            Integrated from `yhl627/argus-reproduction`. Visualizes claims and supporting/contradicting evidence.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input 
            type="text" 
            value={question}
            onChange={e => setQuestion(e.target.value)}
            className="w-80 bg-gray-900 border border-gray-700 text-sm px-3 py-2 rounded text-gray-200 focus:outline-none focus:border-blue-500"
            placeholder="Ask a question..."
          />
          <button 
            onClick={startJob}
            disabled={startingJob}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-semibold transition-colors disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            {startingJob ? 'Starting...' : 'Start Job'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 gap-6 min-h-[600px]">
        {/* Sidebar */}
        <div className="w-72 flex flex-col gap-4 border-r border-gray-800 pr-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-300">Run History</h2>
            <button onClick={fetchRuns} className="text-gray-500 hover:text-gray-300">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
            {runs.length === 0 ? (
              <p className="text-sm text-gray-500 text-center mt-10">No runs found.</p>
            ) : (
              runs.map(run => (
                <div 
                  key={run.run_id}
                  onClick={() => setSelectedRunId(run.run_id)}
                  className={clsx(
                    "p-3 rounded border cursor-pointer transition-colors relative group",
                    selectedRunId === run.run_id 
                      ? "border-blue-500 bg-blue-900/20" 
                      : "border-gray-800 bg-[#0a0a0a] hover:border-gray-600"
                  )}
                >
                  <button 
                    onClick={(e) => deleteRun(run.run_id, e)}
                    className="absolute top-2 right-2 p-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity bg-[#0a0a0a] rounded"
                    title="Delete Run (Local)"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <div className="text-xs font-mono text-gray-300 truncate pr-6">{run.run_id}</div>
                  <div className="text-[10px] text-gray-500 mt-1">
                    {new Date(run.mtime * 1000).toLocaleString()}
                  </div>
                  <div className="flex gap-2 mt-2">
                    {run.has_answer && <span className="text-[9px] bg-green-900/40 text-green-400 px-1.5 py-0.5 rounded">Answered</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Graph Area */}
        <div className="flex-1 bg-[#0a0a0a] border border-gray-800 rounded-lg overflow-hidden relative">
          {loading && (
            <div className="absolute inset-0 z-10 bg-black/50 flex items-center justify-center backdrop-blur-sm">
              <Activity className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
          )}
          
          {!selectedRunId ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
              <GitMerge className="w-12 h-12 mb-4 opacity-20" />
              <p>Select a run from the left sidebar to view its Evidence Graph.</p>
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              fitView
              minZoom={0.1}
              maxZoom={2}
            >
              <Background color="#1f2937" gap={16} />
              <Controls className="bg-gray-900 border-gray-700 fill-gray-300" />
              <MiniMap 
                nodeStrokeColor="#374151" 
                nodeColor="#1f2937" 
                maskColor="rgba(0,0,0,0.5)"
                className="bg-[#050505] border-gray-800"
              />
              <Panel position="top-right" className="bg-gray-900/80 p-3 rounded border border-gray-800 backdrop-blur-md max-w-xs">
                {graphData?.question && (
                  <div className="mb-3">
                    <div className="text-[10px] uppercase text-gray-500 mb-1">Question</div>
                    <div className="text-sm text-gray-200">{graphData.question}</div>
                  </div>
                )}
                {graphData?.final_answer?.answer && (
                  <div>
                    <div className="text-[10px] uppercase text-green-500 mb-1">Final Answer</div>
                    <div className="text-xs text-gray-300 line-clamp-4">{graphData.final_answer.answer}</div>
                  </div>
                )}
              </Panel>
            </ReactFlow>
          )}
        </div>
      </div>
    </div>
  );
}
