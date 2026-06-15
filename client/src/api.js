const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "https://court-booking-system-wjt6.onrender.com";

export function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}