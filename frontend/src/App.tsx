import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import GraphAnalysis from './pages/GraphAnalysis';
import Simulation from './pages/Simulation';
import Timeline from './pages/Timeline';
import EventDetail from './pages/EventDetail';
import EvidenceGraph from './pages/EvidenceGraph';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="event/:eventId" element={<EventDetail />} />
          <Route path="graph" element={<GraphAnalysis />} />
          <Route path="simulation" element={<Simulation />} />
          <Route path="timeline" element={<Timeline />} />
          <Route path="evidence" element={<EvidenceGraph />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
