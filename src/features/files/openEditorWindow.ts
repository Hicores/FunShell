import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauri } from "../../lib/ipc";

const editorWindows = new Map<string, WebviewWindow>();
let editorSequence = 0;

function editorKey(sessionId: string, path: string) {
  return `${sessionId}:${path}`;
}

export async function openRemoteEditorWindow(
  sessionId: string,
  path: string,
  name: string,
  onError: (message: string) => void,
) {
  if (!isTauri()) return false;
  const key = editorKey(sessionId, path);
  const existing = editorWindows.get(key);
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return true;
  }

  const label = `editor-${Date.now()}-${editorSequence++}`;
  const params = new URLSearchParams({ window: "editor", sessionId, path });
  const url = new URL(window.location.href);
  url.search = params.toString();
  url.hash = "";
  const editor = new WebviewWindow(label, {
    url: url.toString(),
    title: `文本编辑 - ${name}`,
    width: 980,
    height: 760,
    minWidth: 560,
    minHeight: 420,
    resizable: true,
    center: true,
    focus: true,
  });
  editorWindows.set(key, editor);
  editor.once("tauri://destroyed", () => editorWindows.delete(key));
  editor.once("tauri://error", (event) => {
    editorWindows.delete(key);
    onError(`打开文本编辑窗口失败：${String(event.payload)}`);
  });
  return true;
}
