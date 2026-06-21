import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/auth";
import Layout from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";
import LoginPage from "./pages/Login";
import CompteurPage from "./pages/Compteur";
import SupervisorPage from "./pages/Supervisor";
import DashboardPage from "./pages/Dashboard";
import AdminPage from "./pages/Admin";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ErrorBoundary label="Erreur sur la page Compteur"><CompteurPage /></ErrorBoundary>} />
        <Route path="/supervisor" element={<ErrorBoundary label="Erreur sur la page Supervision"><SupervisorPage /></ErrorBoundary>} />
        <Route path="/dashboard" element={<ErrorBoundary label="Erreur sur la page Tableau de bord"><DashboardPage /></ErrorBoundary>} />
        <Route path="/admin" element={<ErrorBoundary label="Erreur sur la page Administration"><AdminPage /></ErrorBoundary>} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );
}
