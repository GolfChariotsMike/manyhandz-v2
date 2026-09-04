import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { isLoggedIn } from "./lib/api";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Verify from "./pages/Verify";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import KnowledgeBase from "./pages/KnowledgeBase";
import Voice from "./pages/Voice";
import Capabilities from "./pages/Capabilities";
import Usage from "./pages/Usage";
import FAQ from "./pages/FAQ";
import Chat from "./pages/Chat";
import Team from "./pages/Team";
import Billing from "./pages/Billing";
import Quoting from "./pages/Quoting";
import Admin from "./pages/Admin";
import Connections from "./pages/Connections";
import Tasks from "./pages/Tasks";
import Layout from "./components/Layout";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isLoggedIn()) return <Navigate to="/login" />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
        <Route path="/dashboard" element={<Navigate to="/" replace />} />
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="knowledge-base" element={<KnowledgeBase />} />
          <Route path="voice" element={<Voice />} />
          <Route path="capabilities" element={<Capabilities />} />
          <Route path="email" element={<Navigate to="/connections" replace />} />
          <Route path="chat" element={<Chat />} />
          <Route path="team" element={<Team />} />
          <Route path="billing" element={<Billing />} />
          <Route path="quoting" element={<Quoting />} />
          <Route path="connections" element={<Connections />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="usage" element={<Usage />} />
          <Route path="faq" element={<FAQ />} />
          <Route path="admin" element={<Admin />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
