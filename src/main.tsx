import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";

function RouteNotFound() {
  return (
    <>
      <h1>Not found...</h1>
      Go back to the <Link to="/">home page</Link>!
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename="/rhizz">
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/beczka" element={<App />} />
        <Route path="*" element={<RouteNotFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
