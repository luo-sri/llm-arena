import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { AppLayout, type PageKey } from "@/components/layout";
import Dashboard from "@/pages/Dashboard";
import ModelsPage from "@/pages/ModelsPage";
import QuestionsPage from "@/pages/QuestionsPage";
import SuitesPage from "@/pages/SuitesPage";
import RunsPage from "@/pages/RunsPage";
import RunDetail from "@/pages/RunDetail";
import LeaderboardPage from "@/pages/LeaderboardPage";
import ReviewPage from "@/pages/ReviewPage";
import ReportsPage from "@/pages/ReportsPage";
import SettingsPage from "@/pages/SettingsPage";
import ShareReport from "@/pages/ShareReport";

export default function App() {
  const [shareId, setShareId] = useState<string | null>(null);
  const [page, setPage] = useState<PageKey>("dashboard");
  const [runDetailId, setRunDetailId] = useState<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get("report");
    if (r) setShareId(r);
  }, []);

  if (shareId) {
    return (
      <>
        <ShareReport shareId={shareId} onClose={() => {
          setShareId(null);
          window.history.replaceState(null, "", window.location.pathname);
        }} />
        <Toaster />
      </>
    );
  }

  const openRun = (id: number) => {
    setRunDetailId(id);
    setPage("runDetail");
  };

  return (
    <>
      <AppLayout
        page={page}
        onNavigate={(p) => {
          setPage(p);
          if (p !== "runDetail") setRunDetailId(null);
        }}
      >
        {page === "dashboard" && <Dashboard onOpenRun={openRun} />}
        {page === "models" && <ModelsPage />}
        {page === "questions" && <QuestionsPage />}
        {page === "suites" && <SuitesPage />}
        {page === "runs" && <RunsPage onOpenRun={openRun} />}
        {page === "runDetail" && runDetailId !== null && (
          <RunDetail runId={runDetailId} onBack={() => setPage("runs")} />
        )}
        {page === "leaderboard" && <LeaderboardPage />}
        {page === "review" && <ReviewPage />}
        {page === "reports" && <ReportsPage />}
        {page === "settings" && <SettingsPage />}
      </AppLayout>
      <Toaster />
    </>
  );
}
