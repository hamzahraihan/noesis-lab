/**
 * The route table.
 *
 * Two routes, and the board is in the path rather than in component state: a
 * bench is then a thing you can link to, reload, or send to someone else, and
 * the back button steps through the boards you actually visited instead of
 * silently resetting to the first.
 *
 * `HashRouter` rather than `BrowserRouter` because this app is served as static
 * files with no rewrite rules in front of it. Clean paths would need every
 * request for `/bench/uno` rewritten to `index.html`, and without that
 * configuration a refresh or a shared link 404s. The hash needs no server
 * cooperation at all, which is the one choice that works whatever ends up
 * hosting it.
 */

import { HashRouter, Navigate, Route, Routes } from 'react-router';
import BenchRoute from '@/routes/BenchRoute';
import { HomeRoute } from '@/routes/HomeRoute';
import { BoardsPage } from '@/features/learn';
import { ExercisePage, ExercisesPage, ReferencesPage } from '@/routes/LearnRoutes';
import { ProjectsRoute } from '@/routes/ProjectsRoute';
import { DiagnosticsRoute } from '@/routes/DiagnosticsRoute';
import { DEFAULT_BOARD_ID } from '@/features/learn';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        {/*
         * The Learn section. `/learn/references` is declared before
         * `/learn/:id` because React Router matches in order, and an
         * `:id` segment would otherwise swallow the word "references" and
         * render it as an exercise that does not exist.
         */}
        <Route path="/learn" element={<ExercisesPage />} />
        <Route path="/learn/references" element={<ReferencesPage />} />
        <Route path="/learn/:id" element={<ExercisePage />} />
        <Route path="/projects/:boardId" element={<ProjectsRoute />} />
        <Route path="/" element={<HomeRoute />} />
        <Route path="/boards" element={<BoardsPage />} />
        {/*
         * The bare `/bench` redirect exists so a hand-typed or stale link lands
         * on a working bench rather than an empty one. `replace` keeps it out of
         * the history, so the back button does not bounce through the redirect.
         */}
        <Route path="/bench" element={<Navigate to={`/bench/${DEFAULT_BOARD_ID}`} replace />} />
        <Route path="/bench/:boardId" element={<BenchRoute />} />
        <Route path="/diagnostics" element={<DiagnosticsRoute />} />
        {/* Anything unrecognised goes back to the picker, which is the page that
            can explain what a board is. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
