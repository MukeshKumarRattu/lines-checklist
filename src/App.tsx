import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import LinePage from "./pages/LinePage";
import Submissions from "./pages/Submissions";
import GuardPhotos from "./pages/GuardPhotos";
import AssignGuardPhotos from "./pages/AssignGuardPhotos";
import Edit from "./pages/Edit";
import Maintenance from "./pages/Maintenance";
import Supervisor from "./pages/Supervisor";
import GuardLists from "./pages/GuardLists";
import Summary from "./pages/Summary";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/line/:lineId" element={<LinePage />} />
        <Route path="/submissions" element={<Submissions />} />
        <Route path="/guard-photos" element={<GuardPhotos />} />
        <Route path="/assign-photos" element={<AssignGuardPhotos />} />
        <Route path="/edit" element={<Edit />} />
        <Route path="/maintenance" element={<Maintenance />} />
        <Route path="/supervisor" element={<Supervisor />} />
        <Route path="/supervisor/guards" element={<GuardLists />} />
        <Route path="/summary" element={<Summary />} />
        {/* The daily report lives in Summary's "Daily report" tab. */}
        <Route path="/report" element={<Navigate to="/summary?tab=report" replace />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
