const API_PORT = import.meta.env.VITE_API_PORT || "5050";
const API_PROTOCOL = import.meta.env.VITE_API_PROTOCOL || "http:";

function getDefaultApiBaseUrl() {
  if (typeof window === "undefined") {
    return `http://localhost:${API_PORT}`;
  }

  const hostname = window.location.hostname || "localhost";
  return `${API_PROTOCOL}//${hostname}:${API_PORT}`;
}

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || getDefaultApiBaseUrl()
).replace(/\/$/, "");

export function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}
