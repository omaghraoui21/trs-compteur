import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/auth";
import Layout from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";
import LoginPage from "./pages/Login";
import CompteurPage from "./pages/Compteur";

// The operator's Compteur page is eager (most frequent, must paint instantly on
// shift-floor tablets). The heavier, less-frequent pages are code-split so their
// dependencies (recharts on Dashboard, the full Admin CRUD) stay out of the
// operator's initial bundle.
const SupervisorPage = lazy(() => import("./pages/Supervisor"));
const DashboardPage = lazy(() => import("./pages/Dashboard"));
const AdminPage = lazy(() => import("./pages/Admin"));

function PageSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );
}

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
      <Suspense fallback={<PageSpinner />}>
        <Routes>
          <Route path="/" element={<ErrorBoundary label="Erreur sur la page Compteur"><CompteurPage /></ErrorBoundary>} />
          <Route path="/supervisor" element={<ErrorBoundary label="Erreur sur la page Supervision"><SupervisorPage /></ErrorBoundary>} />
          <Route path="/dashboard" element={<ErrorBoundary label="Erreur sur la page Tableau de bord"><DashboardPage /></ErrorBoundary>} />
          <Route path="/admin" element={<ErrorBoundary label="Erreur sur la page Administration"><AdminPage /></ErrorBoundary>} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
