import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import FullEditor from "./FullEditor.tsx";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { RouteNotFound } from "./RouteNotFound.tsx";
import LocalFileEditor from "./LocalFileEditor.tsx";
import App from "./Navbar.tsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
