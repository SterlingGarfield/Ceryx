import { Navigate, Route, Routes } from "react-router-dom";
import { ConnectionsRoute } from "./ConnectionsRoute";
import { LaunchRoute } from "./LaunchRoute";
import { PairRoute } from "./PairRoute";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/launch" replace />} />
      <Route path="/launch" element={<LaunchRoute />} />
      <Route path="/connections" element={<ConnectionsRoute />} />
      <Route path="/pair/:deviceId" element={<PairRoute />} />
      <Route path="*" element={<Navigate to="/launch" replace />} />
    </Routes>
  );
}
