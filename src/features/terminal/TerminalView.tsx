import { Search, Settings, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { api, isTauri, onEvent } from "../../lib/ipc";
import type { TerminalOutputEvent, WorkspaceTab } from "../../types";

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

export function TerminalView({ tab, active }: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const [command, setCommand] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      allowProposedApi: false,
      convertEol: false,
      fontFamily: '"Cascadia Mono", Consolas, "Microsoft YaHei UI", monospace',
      fontSize: 15,
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

    if (!isTauri()) {
      terminal.writeln("\x1b[36m连接主机...\x1b[0m");
      terminal.writeln("\x1b[32m连接主机成功\x1b[0m");
      terminal.writeln("Last login: Fri Jul 18 09:18:32 2026 from 127.0.0.1");
      terminal.write("\x1b[32mroot@gateway-edge-01\x1b[0m:\x1b[34m~\x1b[0m# ");
    }

    const input = terminal.onData((data) => void api.terminalInput(tab.sessionId, encodeBase64(data)));
    const resize = terminal.onResize(({ cols, rows }) => void api.resizeTerminal(tab.sessionId, cols, rows));
    const observer = new ResizeObserver(() => {
      fit.fit();
      void api.resizeTerminal(tab.sessionId, terminal.cols, terminal.rows);
    });
    observer.observe(hostRef.current);

    let unlisten: (() => void) | undefined;
    void onEvent<TerminalOutputEvent>("terminal-output", (event) => {
      if (event.payload.sessionId === tab.sessionId) terminal.write(decodeBase64(event.payload.dataBase64));
    }).then((dispose) => { unlisten = dispose; });

    return () => {
      unlisten?.();
      observer.disconnect();
      input.dispose();
      resize.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [tab.sessionId]);

  useEffect(() => {
    void api.history(tab.connectionId).then((entries) => setHistory(entries.map((entry) => entry.command))).catch(() => undefined);
    const insert = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string; command: string }>).detail;
      if (detail?.sessionId === tab.sessionId) {
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

  const submit = async () => {
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
    await api.terminalCommand(tab.sessionId, value);
  };

  return (
    <div className="terminal-view">
      <div ref={hostRef} className="xterm-host" />
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
          placeholder="命令输入（Enter 执行，终端区域支持完整交互）"
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
        <button type="button" title="执行" onClick={() => void submit()}><Zap size={17} /></button>
        <button type="button" title="搜索" onClick={() => setSearchOpen((value) => !value)}><Search size={17} /></button>
        <button type="button" title="终端设置"><Settings size={17} /></button>
      </div>
    </div>
  );
}
