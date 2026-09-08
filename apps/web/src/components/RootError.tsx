import { Link } from "@tanstack/react-router";

/**
 * Branded root error boundary: the last-resort catch-all above every route.
 * Like the branded 404 it never renders the caught error — technical text
 * (env vars, upstream messages, stack traces) must not reach the user.
 */
export function RootError() {
  return (
    <main className="app-shell hero compact" aria-labelledby="root-error-title">
      <p className="eyebrow">Animichi</p>
      <h1 id="root-error-title">Something went wrong</h1>
      <p className="tagline">Please try again later.</p>
      <Link className="home-link" to="/">Return home</Link>
    </main>
  );
}
