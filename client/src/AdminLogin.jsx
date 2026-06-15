import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { setAdminToken } from "./adminAuth";
import { apiUrl } from "./api";

export default function AdminLogin() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleLogin(e) {
    e.preventDefault();
    setErrorMessage("");
    setLoading(true);

    try {
      const res = await fetch(apiUrl("/admin/login"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || "Login failed.");
        return;
      }

      setAdminToken(data.token);
      navigate("/admin", { replace: true });
    } catch (error) {
      setErrorMessage("Unable to connect to admin server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>🎾 RacketHub Admin</h1>
        <p>Professional court management system</p>
      </header>

      <section className="booking-form-section user-only-form">
        <form className="single-form" onSubmit={handleLogin}>
          <input
            type="text"
            placeholder="Admin Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {errorMessage && <p className="auth-error">{errorMessage}</p>}

          <button type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </section>
    </div>
  );
}
