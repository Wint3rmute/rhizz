import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import FullEditor from "./FullEditor.tsx";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { RouteNotFound } from "./RouteNotFound.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename="/rhizz">
      <Routes>
        <Route path="/" element={<FullEditor />} />
        <Route path="/beczka" element={<FullEditor />} />
        <Route path="*" element={<RouteNotFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
