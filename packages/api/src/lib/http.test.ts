import { describe, it, expect } from "vitest";
import { assertOperatorOwns, HttpError } from "./http";

describe("assertOperatorOwns", () => {
  it("throws 403 when an operator does not own the record", () => {
    try {
      assertOperatorOwns("operator", "user-1", "user-2");
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(403);
    }
  });

  it("allows an operator who owns the record", () => {
    expect(() => assertOperatorOwns("operator", "user-1", "user-1")).not.toThrow();
  });

  it("bypasses the check when ownerId is null or undefined (un-attributed record)", () => {
    expect(() => assertOperatorOwns("operator", "user-1", null)).not.toThrow();
    expect(() => assertOperatorOwns("operator", "user-1", undefined)).not.toThrow();
  });

  it("does not restrict supervisors or admins", () => {
    expect(() => assertOperatorOwns("supervisor", "user-1", "user-2")).not.toThrow();
    expect(() => assertOperatorOwns("admin", "user-1", "user-2")).not.toThrow();
  });

  it("uses the provided message on the thrown error", () => {
    try {
      assertOperatorOwns("operator", "user-1", "user-2", "Accès refusé personnalisé");
      throw new Error("expected to throw");
    } catch (e) {
      expect((e as HttpError).message).toBe("Accès refusé personnalisé");
    }
  });
});
