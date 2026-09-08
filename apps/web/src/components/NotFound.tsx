import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <main className="app-shell hero compact" aria-labelledby="not-found-title">
      <p className="eyebrow">Animichi</p>
      <h1 id="not-found-title">404</h1>
      <p className="tagline">Page not found</p>
      <Link className="home-link" to="/">Return home</Link>
    </main>
  );
}
