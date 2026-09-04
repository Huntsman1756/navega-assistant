import { describe, it, expect } from "vitest";
import { HelpSessionSchema } from "@guided-web/protocol";
import {
  appendTurn,
  createSession,
  resetSession,
  setCurrentOrigin,
  setGoal,
  trimTurns,
  MAX_TURNS,
} from "./session";

describe("session: create/reset", () => {
  it("first request has empty history", () => {
    const s = createSession();
    expect(s.schemaVersion).toBe(1);
    expect(s.sessionId).toBeTruthy();
    expect(s.turns).toHaveLength(0);
  });

  it("reset creates a fresh conversation", () => {
    let s = createSession();
    s = appendTurn(s, "user", "Quiero encontrar un correo de GitHub.");
    s = appendTurn(s, "assistant", "Estás en Gmail. Pulsa “Recibidos”.");
    expect(s.turns).toHaveLength(2);

    const fresh = resetSession();
    expect(fresh.sessionId).not.toBe(s.sessionId);
    expect(fresh.turns).toHaveLength(0);
  });
});

describe("session: append + goal", () => {
  it("appends user and assistant turns in order", () => {
    let s = createSession();
    s = appendTurn(s, "user", "Quiero encontrar un correo de GitHub.");
    s = appendTurn(s, "assistant", "Estás en Gmail.");
    expect(s.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(s.turns[0]!.text).toBe("Quiero encontrar un correo de GitHub.");
  });

  it("captures the goal from the first user turn only", () => {
    let s = createSession();
    s = appendTurn(s, "user", "Quiero encontrar un correo de GitHub.");
    s = appendTurn(s, "assistant", "Pulsa “Recibidos”.");
    s = appendTurn(s, "user", "Ya estoy.");
    expect(s.goal).toBe("Quiero encontrar un correo de GitHub.");
  });
});

describe("session: bounded trimming", () => {
  it("keeps the most recent turns and never grows without bound", () => {
    let s = createSession();
    for (let i = 0; i < 30; i += 1) {
      s = appendTurn(s, "user", `turn ${i}`);
      s = appendTurn(s, "assistant", `answer ${i}`);
    }
    expect(s.turns.length).toBe(MAX_TURNS);
    expect(s.turns[0]!.text).toBe("turn 25");
    expect(s.turns[s.turns.length - 1]!.text).toBe("answer 29");
  });

  it("trimTurns is deterministic", () => {
    const turns = Array.from({ length: 12 }, (_, i) => ({
      role: "user" as const,
      text: `t${i}`,
      timestamp: i,
    }));
    const trimmed = trimTurns(turns, 10);
    expect(trimmed).toHaveLength(10);
    expect(trimmed.map((t) => t.text)).toEqual(["t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10", "t11"]);
  });
});

describe("session: secrets never retained", () => {
  it("password value never appears in history", () => {
    let s = createSession();
    s = appendTurn(s, "user", "mi contraseña es abc123");
    expect(JSON.stringify(s)).not.toContain("abc123");
  });

  it("OTP value never appears in history", () => {
    let s = createSession();
    s = appendTurn(s, "user", "el código es 987654");
    expect(JSON.stringify(s)).not.toContain("987654");
  });

  it("card value never appears in history", () => {
    let s = createSession();
    s = appendTurn(s, "user", "mi tarjeta es 4111111111111111");
    expect(JSON.stringify(s)).not.toContain("4111111111111111");
  });
});

describe("session: origin + snapshot isolation", () => {
  it("origin change preserves goal but uses the new current origin", () => {
    let s = createSession();
    s = appendTurn(s, "user", "No puedo recuperar mi cuenta.");
    s = setCurrentOrigin(s, "https://accounts.example.com");
    s = setCurrentOrigin(s, "https://recovery.example.com");
    expect(s.goal).toBe("No puedo recuperar mi cuenta.");
    expect(s.currentOrigin).toBe("https://recovery.example.com");
  });

  it("does not persist a page snapshot inside turn history", () => {
    let s = createSession();
    s = appendTurn(s, "user", "¿Qué es esta página?");
    s = appendTurn(s, "assistant", "Es una página de inicio de sesión.");
    // The session object must never contain a snapshot-shaped field.
    expect(s).not.toHaveProperty("snapshot");
    expect(s.turns.every((t) => !("snapshot" in t))).toBe(true);
    // And it must validate under the strict session schema.
    expect(HelpSessionSchema.safeParse(s).success).toBe(true);
  });
});

describe("session: goal setter", () => {
  it("setGoal overrides and trims", () => {
    let s = createSession();
    s = setGoal(s, "   Comprar un producto  ");
    expect(s.goal).toBe("Comprar un producto");
  });
});
