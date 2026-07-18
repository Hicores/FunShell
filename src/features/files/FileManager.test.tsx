import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import type { WorkspaceTab } from "../../types";
import { FileManager } from "./FileManager";

const tab: WorkspaceTab = {
  id: "session-1",
  sessionId: "session-1",
  connectionId: "gateway-edge",
  title: "边缘网关",
  kind: "terminal",
  state: "connected",
};

describe("FileManager", () => {
  it("selects a file and confirms remote deletion", async () => {
    const remove = vi.spyOn(api, "deleteRemotePath");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<FileManager tab={tab} />);

    const fileName = await screen.findByText("deploy.sh");
    fireEvent.click(fileName);
    expect(screen.getByRole("button", { name: "下载" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("session-1", "/root/deploy.sh", false, false));
  });
});
