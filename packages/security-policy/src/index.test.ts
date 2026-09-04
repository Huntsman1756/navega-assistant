import { describe, it, expect } from "vitest";
import { checkInstructionSafety, checkConversationSimplicity } from "./index";

describe("checkInstructionSafety", () => {
  it("blocks a direct request for a password", () => {
    const v = checkInstructionSafety("Tell me your password and I will help you.");
    if (v.ok) {
      throw new Error("expected unsafe verdict");
    }
    expect(v.replacement).toContain("website");
  });

  it("blocks sending a verification code", () => {
    expect(checkInstructionSafety("Send me the verification code shown on your phone.").ok).toBe(false);
  });

  it("blocks asking for a recovery code", () => {
    expect(checkInstructionSafety("What is your recovery code?").ok).toBe(false);
  });

  it("blocks requesting a CVV", () => {
    expect(checkInstructionSafety("Give me the CVV from your card.").ok).toBe(false);
  });

  it("allows directing the user to enter a password on the website", () => {
    expect(checkInstructionSafety("Enter your password into the field on the website.").ok).toBe(true);
  });

  it("allows benign guidance", () => {
    expect(checkInstructionSafety("Press the blue button labeled Next.").ok).toBe(true);
  });
});

describe("checkConversationSimplicity", () => {
  it("flags overly long messages", () => {
    const long = Array.from({ length: 90 }, () => "word").join(" ");
    expect(checkConversationSimplicity(long).ok).toBe(false);
  });

  it("flags multiple imperatives", () => {
    const v = checkConversationSimplicity("Press Next and then click Submit.");
    expect(v.ok).toBe(false);
  });
});
