import { Navigate, Route, Routes } from "react-router-dom";
import { ConsoleRoute } from "./ConsoleRoute";
import { HomeRoute } from "./HomeRoute";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/console" element={<ConsoleRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
