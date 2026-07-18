import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import { EditorWindow } from "./EditorWindow";

describe("EditorWindow", () => {
  it("saves edited content and shows confirmation", async () => {
    vi.spyOn(api, "readRemoteText").mockResolvedValue({ path: "/root/app.conf", content: "port=22\n", size: 8 });
    const write = vi.spyOn(api, "writeRemoteText").mockResolvedValue(undefined);
    render(<EditorWindow sessionId="session-1" path="/root/app.conf" />);

    const editor = await screen.findByRole("textbox");
    fireEvent.change(editor, { target: { value: "port=2222\n" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(write).toHaveBeenCalledWith("session-1", "/root/app.conf", "port=2222\n"));
    expect(screen.getByRole("status")).toHaveTextContent("已保存");
  });
});
