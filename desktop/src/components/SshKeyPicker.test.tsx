import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SshKeySelector } from "../lib/ssh-key-picker";
import SshKeyPicker from "./SshKeyPicker";

function Harness({ initial = "", pickKey }: { initial?: string; pickKey: SshKeySelector }) {
  const [value, setValue] = useState(initial);
  return <SshKeyPicker value={value} onChange={setValue} pickKey={pickKey} />;
}

describe("SshKeyPicker", () => {
  it("selects a key while exposing only its basename in the document", async () => {
    const user = userEvent.setup();
    const fullPath = "/Users/synthetic/.ssh/id_ed25519";
    const { container } = render(<Harness pickKey={vi.fn().mockResolvedValue(fullPath)} />);

    await user.click(screen.getByRole("button", { name: "Scegli chiave…" }));

    expect(screen.getByRole("status")).toHaveTextContent("Chiave selezionata: id_ed25519");
    expect(container).not.toHaveTextContent(fullPath);
    expect(container.querySelector("input")).toBeNull();
  });

  it("keeps the current key when the native dialog is cancelled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const fullPath = "/private/account/.ssh/id_rsa";
    const { container } = render(
      <SshKeyPicker value={fullPath} onChange={onChange} pickKey={vi.fn().mockResolvedValue(null)} />,
    );

    await user.click(screen.getByRole("button", { name: "Cambia chiave…" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Chiave selezionata: id_rsa");
    expect(container).not.toHaveTextContent(fullPath);
  });

  it("replaces and removes a selected key", async () => {
    const user = userEvent.setup();
    const pickKey = vi.fn().mockResolvedValue("C:\\Users\\synthetic\\.ssh\\work_key");
    render(<Harness initial="/Users/synthetic/.ssh/id_ed25519" pickKey={pickKey} />);

    await user.click(screen.getByRole("button", { name: "Cambia chiave…" }));
    expect(screen.getByRole("status")).toHaveTextContent("Chiave selezionata: work_key");
    expect(screen.queryByText("id_ed25519")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rimuovi chiave" }));
    expect(screen.getByRole("status")).toHaveTextContent("Nessuna chiave selezionata");
    expect(screen.getByRole("button", { name: "Scegli chiave…" })).toBeEnabled();
  });

  it("falls back to an accessible error without clearing the current value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SshKeyPicker
        value="/Users/synthetic/.ssh/id_ed25519"
        onChange={onChange}
        pickKey={vi.fn().mockRejectedValue(new Error("native unavailable"))}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Cambia chiave…" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Non riesco ad aprire il selettore file");
    expect(screen.getByRole("status")).toHaveTextContent("Chiave selezionata: id_ed25519");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("has a named group, live status and operable labelled controls", () => {
    render(<Harness pickKey={vi.fn().mockResolvedValue(null)} />);

    expect(screen.getByRole("group", { name: "File chiave SSH" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Nessuna chiave selezionata");
    expect(screen.getByRole("button", { name: "Scegli chiave…" })).toHaveAttribute(
      "aria-describedby",
      screen.getByRole("status").id,
    );
  });
});
