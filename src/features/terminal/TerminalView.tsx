import { Search, Settings, Zap } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { ContextMenu } from "../../components/common/ContextMenu";
import { api, isTauri, onEvent } from "../../lib/ipc";
import { useAppStore } from "../../stores/appStore";
import type { TerminalOutputEvent, WorkspaceTab } from "../../types";
import { DEFAULT_TERMINAL_FONT_FAMILY, TerminalSettingsDialog } from "./TerminalSettingsDialog";

function encodeBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return window.btoa(binary);
}

function decodeBase64(value: string) {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

interface TerminalViewProps {
  tab: WorkspaceTab;
  active: boolean;
}

export type TerminalContextAction = "copy" | "paste";

export function terminalContextAction(selection: string, clipboard: string): TerminalContextAction | null {
  if (selection) return "copy";
  return clipboard ? "paste" : null;
}

export function TerminalView({ tab, active }: TerminalViewProps) {
  const notify = useAppStore((state) => state.notify);
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef(tab.sessionId);
  const connectionIdRef = useRef(tab.connectionId);
  const stateRef = useRef(tab.state);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const [command, setCommand] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const inputBufferRef = useRef("");
  const escapeSequenceRef = useRef(false);
  const [context, setContext] = useState<{ x: number; y: number; action: TerminalContextAction; text: string } | null>(null);
  const contextRequestRef = useRef(0);
  const [terminalFontFamily, setTerminalFontFamily] = useState(DEFAULT_TERMINAL_FONT_FAMILY);
  const [terminalFontSize, setTerminalFontSize] = useState(13);
  const [terminalSettingsOpen, setTerminalSettingsOpen] = useState(false);
  const [savingTerminalSettings, setSavingTerminalSettings] = useState(false);
  sessionIdRef.current = tab.sessionId;
  connectionIdRef.current = tab.connectionId;
  stateRef.current = tab.state;

  useEffect(() => {
    if (!hostRef.current) return;
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      allowProposedApi: false,
      convertEol: false,
      fontFamily: terminalFontFamily,
      fontSize: terminalFontSize,
      lineHeight: 1.18,
      scrollback: 10000,
      theme: {
        background: "#173245",
        foreground: "#eef6f8",
        cursor: "#39d57d",
        cursorAccent: "#173245",
        selectionBackground: "#4b7f9a88",
        black: "#17242c",
        red: "#ff6b6b",
        green: "#62d890",
        yellow: "#ffd166",
        blue: "#65b5ed",
        magenta: "#d8a7ff",
        cyan: "#62d4d1",
        white: "#f4f7f8",
        brightBlack: "#71808a",
      },
    });
    const fit = new FitAddon();
    const searchAddon = new SearchAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(hostRef.current);
    fit.fit();
    terminalRef.current = terminal;
    fitRef.current = fit;
    searchRef.current = searchAddon;

    if (tab.state === "connecting") {
      terminal.writeln(`\x1b[36m正在连接 ${tab.title}...\x1b[0m`);
    } else if (!isTauri()) {
      terminal.writeln("\x1b[36m连接主机...\x1b[0m");
      terminal.writeln("\x1b[32m连接主机成功\x1b[0m");
      terminal.writeln("Last login: Fri Jul 18 09:18:32 2026 from 127.0.0.1");
      terminal.write("\x1b[32mroot@gateway-edge-01\x1b[0m:\x1b[34m~\x1b[0m# ");
    }

    const input = terminal.onData((data) => {
      if (stateRef.current !== "connected") return;
      void api.terminalInput(sessionIdRef.current, encodeBase64(data));
      let line = inputBufferRef.current;
      let inEscapeSequence = escapeSequenceRef.current;
      for (const character of data) {
        if (inEscapeSequence) {
          if (/[A-Za-z~]/.test(character)) inEscapeSequence = false;
          continue;
        }
        if (character === "\x1b") { inEscapeSequence = true; continue; }
        if (character === "\r" || character === "\n") {
          const commandText = line.trim();
          if (commandText) {
            void api.recordHistory(connectionIdRef.current, commandText)
              .then(() => window.dispatchEvent(new CustomEvent("funshell-command-executed", { detail: { sessionId: sessionIdRef.current } })))
              .catch(() => undefined);
          }
          line = "";
          continue;
        }
        if (character === "\u007f") { line = line.slice(0, -1); continue; }
        if (character === "\u0003" || character === "\u0015") { line = ""; continue; }
        if (character === "\u0017") { line = line.replace(/\s*\S+\s*$/, ""); continue; }
        if (character === "\t" || character >= " ") line += character;
      }
      inputBufferRef.current = line;
      escapeSequenceRef.current = inEscapeSequence;
    });
    const resize = terminal.onResize(({ cols, rows }) => {
      if (stateRef.current === "connected") void api.resizeTerminal(sessionIdRef.current, cols, rows);
    });
    const observer = new ResizeObserver(() => {
      fit.fit();
      if (stateRef.current === "connected") void api.resizeTerminal(sessionIdRef.current, terminal.cols, terminal.rows);
    });
    observer.observe(hostRef.current);

    let unlisten: (() => void) | undefined;
    void onEvent<TerminalOutputEvent>("terminal-output", (event) => {
      if (event.payload.sessionId === sessionIdRef.current) terminal.write(decodeBase64(event.payload.dataBase64));
    }).then((dispose) => { unlisten = dispose; });

    return () => {
      unlisten?.();
      observer.disconnect();
      input.dispose();
      resize.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, []);

  const applyTerminalSettings = (fontFamily: string, fontSize: number) => {
    setTerminalFontFamily(fontFamily);
    setTerminalFontSize(fontSize);
    const terminal = terminalRef.current;
    if (terminal) {
      terminal.options.fontFamily = fontFamily;
      terminal.options.fontSize = fontSize;
      fitRef.current?.fit();
    }
  };

  useEffect(() => {
    const onTerminalStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ tabId: string; state: string; message: string }>).detail;
      if (detail?.tabId !== tab.id || !detail.message || !terminalRef.current) return;
      const color = detail.state === "connected" || detail.state === "reconnected" ? "32" : detail.state === "error" ? "31" : "33";
      terminalRef.current.writeln(`\r\n\x1b[${color}m${detail.message}\x1b[0m`);
    };
    window.addEventListener("funshell-terminal-status", onTerminalStatus);
    return () => window.removeEventListener("funshell-terminal-status", onTerminalStatus);
  }, [tab.id]);

  useEffect(() => {
    let active = true;
    void api.getSettings().then((settings) => {
      if (active) applyTerminalSettings(settings.terminalFontFamily, settings.terminalFontSize);
    }).catch((error) => notify(String(error)));
    return () => { active = false; };
  }, [notify, tab.sessionId]);

  useEffect(() => {
    const onSettingsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ fontFamily: string; fontSize: number }>).detail;
      if (detail?.fontFamily && Number.isFinite(detail.fontSize)) applyTerminalSettings(detail.fontFamily, detail.fontSize);
    };
    window.addEventListener("funshell-terminal-settings-changed", onSettingsChanged);
    return () => window.removeEventListener("funshell-terminal-settings-changed", onSettingsChanged);
  }, [tab.sessionId]);

  useEffect(() => {
    void api.history(tab.connectionId).then((entries) => setHistory(entries.map((entry) => entry.command))).catch(() => undefined);
    const insert = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string; command: string }>).detail;
      if (detail?.sessionId === sessionIdRef.current) {
        setCommand(detail.command);
        setHistoryIndex(null);
      }
    };
    window.addEventListener("funshell-insert-command", insert);
    return () => window.removeEventListener("funshell-insert-command", insert);
  }, [tab.connectionId, tab.sessionId]);

  useEffect(() => {
    if (active) window.setTimeout(() => fitRef.current?.fit(), 0);
  }, [active]);

  useEffect(() => {
    if (tab.state !== "connected") return;
    const timer = window.setTimeout(() => {
      fitRef.current?.fit();
      const terminal = terminalRef.current;
      if (terminal) void api.resizeTerminal(sessionIdRef.current, terminal.cols, terminal.rows);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [tab.state]);

  const submit = async () => {
    if (stateRef.current !== "connected") {
      notify("服务器仍在连接中");
      return;
    }
    const value = command.trimEnd();
    if (!value) return;
    setCommand("");
    setHistory((current) => [value, ...current.filter((item) => item !== value)].slice(0, 300));
    setHistoryIndex(null);
    if (!isTauri()) {
      terminalRef.current?.writeln(value);
      terminalRef.current?.writeln(`\x1b[90m[demo] command accepted: ${value}\x1b[0m`);
      terminalRef.current?.write("\x1b[32mroot@gateway-edge-01\x1b[0m:\x1b[34m~\x1b[0m# ");
    }
    await api.terminalCommand(sessionIdRef.current, value);
    window.dispatchEvent(new CustomEvent("funshell-command-executed", { detail: { sessionId: sessionIdRef.current } }));
  };

  const openTerminalContextMenu = async (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const terminal = terminalRef.current;
    if (!terminal) return;
    const selection = terminal.hasSelection() ? terminal.getSelection() : "";
    if (selection) {
      setContext({ x: event.clientX, y: event.clientY, action: "copy", text: selection });
      return;
    }
    const request = ++contextRequestRef.current;
    let clipboard = "";
    try {
      clipboard = await navigator.clipboard.readText();
    } catch {
      clipboard = "";
    }
    if (request !== contextRequestRef.current) return;
    const action = terminalContextAction(selection, clipboard);
    setContext(action ? { x: event.clientX, y: event.clientY, action, text: clipboard } : null);
  };

  const copySelection = async () => {
    if (!context?.text) return;
    try {
      await navigator.clipboard.writeText(context.text);
      terminalRef.current?.clearSelection();
    } catch (error) {
      notify(`复制文本失败: ${String(error)}`);
    }
  };

  const pasteClipboard = () => {
    if (context?.text) terminalRef.current?.paste(context.text);
  };

  const saveTerminalSettings = async () => {
    const fontFamily = terminalFontFamily.trim();
    const fontSize = Math.round(terminalFontSize);
    if (!fontFamily || !Number.isFinite(fontSize) || fontSize < 9 || fontSize > 32) {
      notify("终端字体大小必须在 9 到 32 之间，字体名称不能为空");
      return;
    }
    setSavingTerminalSettings(true);
    try {
      const current = await api.getSettings();
      const saved = await api.saveSettings({ ...current, terminalFontFamily: fontFamily, terminalFontSize: fontSize });
      applyTerminalSettings(saved.terminalFontFamily, saved.terminalFontSize);
      window.dispatchEvent(new CustomEvent("funshell-terminal-settings-changed", { detail: { fontFamily: saved.terminalFontFamily, fontSize: saved.terminalFontSize } }));
      setTerminalSettingsOpen(false);
      notify("终端设置已保存");
    } catch (error) {
      notify(String(error));
    } finally {
      setSavingTerminalSettings(false);
    }
  };

  return (
    <div className="terminal-view">
      <div ref={hostRef} className="xterm-host" onContextMenu={(event) => void openTerminalContextMenu(event)} />
      {context && (
        <ContextMenu x={context.x} y={context.y} onClose={() => setContext(null)}>
          <button type="button" onClick={() => void (context.action === "copy" ? copySelection() : pasteClipboard())}>{context.action === "copy" ? "复制文本" : "粘贴"}</button>
        </ContextMenu>
      )}
      <TerminalSettingsDialog
        open={terminalSettingsOpen}
        fontFamily={terminalFontFamily}
        fontSize={terminalFontSize}
        saving={savingTerminalSettings}
        onFontFamilyChange={setTerminalFontFamily}
        onFontSizeChange={setTerminalFontSize}
        onClose={() => setTerminalSettingsOpen(false)}
        onSave={() => void saveTerminalSettings()}
      />
      {searchOpen && (
        <div className="terminal-search">
          <input autoFocus placeholder="查找终端内容" value={search} onChange={(event) => { setSearch(event.target.value); searchRef.current?.findNext(event.target.value); }} />
          <button type="button" onClick={() => searchRef.current?.findPrevious(search)}>上一个</button>
          <button type="button" onClick={() => searchRef.current?.findNext(search)}>下一个</button>
          <button type="button" onClick={() => setSearchOpen(false)}>关闭</button>
        </div>
      )}
      <div className="command-bar">
        <input
          value={command}
          disabled={tab.state !== "connected"}
          placeholder={tab.state === "connecting" ? "正在连接服务器..." : tab.state === "error" ? "连接失败，请重新连接" : "命令输入（Enter 执行，终端区域支持完整交互）"}
          onChange={(event) => { setCommand(event.target.value); setHistoryIndex(null); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); return; }
            if (event.key === "ArrowUp" && history.length) {
              event.preventDefault();
              const next = Math.min((historyIndex ?? -1) + 1, history.length - 1);
              setHistoryIndex(next); setCommand(history[next]);
            }
            if (event.key === "ArrowDown" && historyIndex != null) {
              event.preventDefault();
              const next = historyIndex - 1;
              setHistoryIndex(next >= 0 ? next : null); setCommand(next >= 0 ? history[next] : "");
            }
          }}
        />
        <button type="button" title="执行" disabled={tab.state !== "connected"} onClick={() => void submit()}><Zap size={17} /></button>
        <button type="button" title="搜索" onClick={() => setSearchOpen((value) => !value)}><Search size={17} /></button>
        <button type="button" aria-label="终端设置" title="终端设置" onClick={() => setTerminalSettingsOpen(true)}><Settings size={17} /></button>
      </div>
    </div>
  );
}
