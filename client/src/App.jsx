import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import UserApp from "./UserApp";
import AdminApp from "./AdminApp";
import AdminLogin from "./AdminLogin";
import { getAdminToken } from "./adminAuth";
import "./App.css";

function ProtectedAdminRoute() {
  const token = getAdminToken();
  if (!token) {
    return <Navigate to="/admin/login" replace />;
  }
  return <AdminApp />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<UserApp />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<ProtectedAdminRoute />} />
      </Routes>
    </BrowserRouter>
  );
}
