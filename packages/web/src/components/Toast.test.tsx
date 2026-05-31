import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ToastProvider, useToast } from "./Toast";

function Trigger() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.success("Enregistré")}>ok</button>
      <button onClick={() => toast.error("Échec réseau")}>fail</button>
    </div>
  );
}

describe("Toast", () => {
  it("shows a success message when pushed", () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    act(() => { screen.getByText("ok").click(); });
    expect(screen.getByText("Enregistré")).toBeInTheDocument();
  });

  it("shows an error message when pushed", () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    act(() => { screen.getByText("fail").click(); });
    expect(screen.getByText("Échec réseau")).toBeInTheDocument();
  });

  it("throws if useToast is used outside a ToastProvider", () => {
    const Bare = () => { useToast(); return null; };
    // React logs the error; we only assert it throws.
    expect(() => render(<Bare />)).toThrow(/ToastProvider/i);
  });
});
