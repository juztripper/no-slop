/// <reference types="vite/client" />
import React from "react";
import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import { Options } from "./Options";
import { Popup } from "./Popup";
import "@radix-ui/themes/styles.css";
import "./styles.css";

const popup = location.pathname.endsWith("popup.html");
document.body.classList.toggle("popup-body", popup);
const root = createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <Theme
      className={`no-slop-theme${popup ? " popup-theme" : ""}`}
      accentColor="gray"
      grayColor="gray"
      appearance="light"
      radius="medium"
      scaling="100%"
    >
      {popup ? <Popup /> : <Options />}
    </Theme>
  </React.StrictMode>,
);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
