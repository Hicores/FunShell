import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "./styles/global.css";
import "./styles/controls.css";
import "./styles/views.css";
import { App } from "./app/App";
import { EditorWindow } from "./features/files/EditorWindow";

const params = new URLSearchParams(window.location.search);
const editorWindow = params.get("window") === "editor";
const editorSessionId = params.get("sessionId");
const editorPath = params.get("path");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {editorWindow && editorSessionId && editorPath ? <EditorWindow sessionId={editorSessionId} path={editorPath} /> : <App />}
  </StrictMode>,
);
