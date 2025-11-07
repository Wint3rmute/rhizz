import React from "react";
import { createRoot } from "react-dom/client";
import FullEditor from "./FullEditor.tsx";
import App from "./Navbar.tsx";
import { StrictMode } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { RouteNotFound } from "./RouteNotFound.tsx";
import LocalFileEditor from "./LocalFileEditor.tsx";

const root = createRoot(document.body);

root.render(
  <StrictMode>
    <App>
      <BrowserRouter basename="/">
        <Routes>
          <Route path="/" element={<FullEditor />} />
          <Route path="/local" element={<LocalFileEditor />} />
          <Route path="*" element={<RouteNotFound />} />
        </Routes>
      </BrowserRouter>
    </App>
  </StrictMode>,
);
