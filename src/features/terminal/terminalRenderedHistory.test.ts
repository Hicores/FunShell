import { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { TerminalRenderedHistory } from "./terminalRenderedHistory";

describe("history from the remote shell's rendered command", () => {
  let terminal: Terminal;
  let history: TerminalRenderedHistory;
  let record: Mock<(command: string) => void>;
  const prompt = "root@server:~# ";
  const encode = (text: string) => new TextEncoder().encode(text);
  const flush = () => new Promise<void>((resolve) => terminal.write("", resolve));
  const input = (text: string) => history.input(text, record);
  const output = (text: string) => history.output(encode(text));

  beforeEach(async () => {
    terminal = new Terminal({ cols: 60, rows: 10, allowProposedApi: false });
    history = new TerminalRenderedHistory(terminal);
    record = vi.fn<(command: string) => void>();
    terminal.write(prompt);
    await flush();
  });

  afterEach(() => {
    history.reset();
    terminal.dispose();
  });

  it("records the whole recalled command after replacing stop with start", async () => {
    input("\x1b[A");
    output("systemctl stop server_main");
    await flush();
    input("\x1b[15D");
    input("\x1b[3~\x1b[3~");
    input("art");
    output(`\r${prompt}systemctl start server_main\x1b[K`);
    input("\r");
    expect(record).not.toHaveBeenCalled();
    output(`\r\nservice started\r\n${prompt}`);
    await flush();

    expect(record).toHaveBeenCalledExactlyOnceWith("systemctl start server_main");
  });

  it("waits for delayed echo and captures an unedited recalled command", async () => {
    input("\x1bOA");
    input("\r");
    expect(record).not.toHaveBeenCalled();
    output("uname -a\r");
    await flush();
    expect(record).not.toHaveBeenCalled();
    output(`\nLinux server\r\n${prompt}`);
    await flush();

    expect(record).toHaveBeenCalledExactlyOnceWith("uname -a");
  });

  it("uses the final line after cursor edits rather than the appended keystrokes", async () => {
    input("echo hllo");
    output("echo hllo");
    input("\x1b[D\x1b[D\x1b[D");
    output("\x1b[3D");
    input("e");
    output("ello\x1b[3D");
    input("\r");
    output("\x1b[3C\r\nhello\r\n");
    await flush();

    expect(record).toHaveBeenCalledExactlyOnceWith("echo hello");
  });

  it("records the shell's tab completion", async () => {
    input("systemctl status ngi");
    output("systemctl status ngi");
    input("\t");
    output("nx");
    input("\r");
    output("\r\nactive\r\n");
    await flush();

    expect(record).toHaveBeenCalledExactlyOnceWith("systemctl status nginx");
  });

  it("joins wrapped rows and preserves Unicode and spaces with colored prompts", async () => {
    terminal.reset();
    terminal.resize(24, 10);
    terminal.write("\x1b[32m用户@server\x1b[0m:~# ");
    const command = "printf '%s' '这是一条较长的命令 with spaces and wraps'";
    await flush();
    input("\x1b[A");
    const bytes = encode(command);
    // An SSH packet may end halfway through a UTF-8 character.
    const split = bytes.indexOf(0xe8) + 1;
    history.output(bytes.subarray(0, split));
    history.output(bytes.subarray(split));
    input("\r");
    output("\r\n");
    await flush();

    expect(record).toHaveBeenCalledExactlyOnceWith(command);
  });

  it("keeps a bracketed multiline paste as one exact entry", () => {
    const command = "cat <<'EOF'\nhello\nEOF";
    input(`\x1b[200~${command}\x1b[201~`);
    expect(record).not.toHaveBeenCalled();
    input("\r");
    expect(record).toHaveBeenCalledExactlyOnceWith(command);
  });

  it("does not treat an older queued newline as the recalled command's Enter", async () => {
    output("\r\n");
    output(prompt);
    input("\x1b[A");
    input("\r");
    output("hostname\r\n");
    await flush();

    expect(record).toHaveBeenCalledExactlyOnceWith("hostname");
  });

  it("does not record canceled input or callbacks from a closed session", async () => {
    input("\x1b[A");
    output("echo canceled");
    input("\x03");
    output(`^C\r\n${prompt}`);
    await flush();
    input("\x1b[A");
    input("\r");
    output("echo closed\r\n");
    history.reset();
    await flush();

    expect(record).not.toHaveBeenCalled();
  });

  it("ignores keystrokes inside an alternate-screen application", async () => {
    output("\x1b[?1049h");
    await flush();
    input("editor text\r");
    output("\r\n");
    await flush();

    expect(record).not.toHaveBeenCalled();
  });
});
