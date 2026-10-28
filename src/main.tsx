import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from '@/app/App';

/**
 * A clean path onto the hash router.
 *
 * The app routes on the hash so that a bench is a link which survives a reload
 * on static hosting (see `app/App.tsx`). That deliberately leaves the pathname
 * outside the router, which has one gap: a link written the ordinary way,
 * `/boards`, arrives with an empty hash and the catch-all route sends it home.
 * Folding the pathname into the hash before the router mounts closes the gap
 * without giving up the no-rewrite property: the address becomes `/#/boards`
 * and the page renders.
 *
 * The prefixes are the router's own top-level sections, so anything deeper
 * (`/learn/0.1`, `/projects/uno`, `/bench/nano`) is adopted by the same rule and
 * the router still decides what the rest of the path means. This runs after the
 * host has already answered, so it can only convert a request it can see: a host
 * without a rewrite rule returns its own 404 for a clean path before any of this
 * code loads.
 */
const CLEAN_PREFIXES = ['/boards', '/learn', '/projects', '/bench', '/diagnostics'];

function isCleanPage(pathname: string): boolean {
  return CLEAN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function adoptCleanPath(): void {
  const { pathname, search, hash } = window.location;
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (hash !== '' || !isCleanPage(path)) return;
  window.history.replaceState(null, '', `/#${path}${search}`);
}

adoptCleanPath();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
