import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import type { WorkspaceTab } from "../../types";
import { CommandPanel, resolvePresetVariables } from "./CommandPanel";

const tab: WorkspaceTab = { id: "terminal-history", sessionId: "session-history", connectionId: "connection-history", title: "History", kind: "terminal", state: "connected" };

describe("command preset variables", () => {
  it("asks once per variable and replaces all occurrences", () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("nginx");
    expect(resolvePresetVariables("systemctl restart ${service} && status ${service}"))
      .toBe("systemctl restart nginx && status nginx");
    expect(prompt).toHaveBeenCalledOnce();
  });

  it("stops insertion when variable input is canceled", () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    expect(resolvePresetVariables("echo ${value}")).toBeNull();
  });

  it("inserts a clicked history command into the terminal input", async () => {
    vi.spyOn(api, "history").mockResolvedValue([{ id: "history-1", connectionId: tab.connectionId, command: "systemctl status nginx", favorite: false, executedAt: "2026-07-18T10:00:00Z" }]);
    const listener = vi.fn();
    window.addEventListener("funshell-insert-command", listener);
    render(<CommandPanel tab={tab} />);

    const command = await screen.findByRole("button", { name: "systemctl status nginx" });
    fireEvent.click(command);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: { sessionId: tab.sessionId, command: "systemctl status nginx" } }));
    window.removeEventListener("funshell-insert-command", listener);
  });
});
