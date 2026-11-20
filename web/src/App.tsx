import { lazy, Suspense, useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import Landing from "./pages/Landing";

// The viva room pulls in the Gemini SDK; keep it out of the landing bundle.
const VivaRoom = lazy(() => import("./pages/VivaRoom"));
const Analyse = lazy(() => import("./pages/Analyse"));
// Monaco is heavy; it only loads on the bug hunt page.
const BugHunt = lazy(() => import("./pages/BugHunt"));
const Report = lazy(() => import("./pages/Report"));
const Recruiter = lazy(() => import("./pages/Recruiter"));

export default function App() {
  const location = useLocation();

  // New page → start at the top (client-side navigation keeps the old scroll position otherwise).
  // Block body on purpose: newer browsers make scrollTo() return a Promise, and an effect must return nothing.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    // Every framer-motion animation honours the OS "reduce motion" setting.
    <MotionConfig reducedMotion="user">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <AnimatePresence mode="wait">
        <motion.div key={location.pathname} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <Suspense fallback={<div className="min-h-dvh" />}>
            <Routes location={location}>
              <Route path="/" element={<Landing />} />
              <Route path="/analyse" element={<Analyse />} />
              <Route path="/viva" element={<VivaRoom />} />
              <Route path="/bughunt" element={<BugHunt />} />
              <Route path="/report/:id" element={<Report />} />
              <Route path="/recruiter" element={<Recruiter />} />
              <Route path="*" element={<Landing />} />
            </Routes>
          </Suspense>
        </motion.div>
      </AnimatePresence>
    </MotionConfig>
  );
}
