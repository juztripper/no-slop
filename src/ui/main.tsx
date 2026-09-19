/// <reference types="vite/client" />
import React from "react";
import { createRoot } from "react-dom/client";
import { Options } from "./Options";
import { Popup } from "./Popup";
import "./styles.css";

const popup = location.pathname.endsWith("popup.html");
document.body.classList.toggle("popup-body", popup);
const root = createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>{popup ? <Popup /> : <Options />}</React.StrictMode>,
);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
