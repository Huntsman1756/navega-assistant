// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { extractAccessibleDOMSnapshot } from "./extractor";
import { classifySecretField, shouldExcludeElement } from "./sanitizer";

function setHtml(html: string): void {
  document.documentElement.innerHTML = "";
  document.documentElement.innerHTML = `<head><title>Test</title></head><body>${html}</body>`;
  document.body.innerHTML = html;
  document.title = "Test";
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("extractAccessibleDOMSnapshot", () => {
  beforeEach(() => setHtml(``));

  it("extracts a login form from DOM", () => {
    setHtml(`
      <form>
        <label for="email">Email</label>
        <input id="email" type="email" placeholder="you@example.com">
        <label for="pass">Password</label>
        <input id="pass" type="password">
        <button type="submit">Sign in</button>
      </form>
    `);
    const snap = extractAccessibleDOMSnapshot(document, { snapshotId: "snap-1" });
    expect(snap.schemaVersion).toBe(1);
    expect(snap.snapshotId).toBe("snap-1");
    expect(snap.page.title).toBe("Test");
    const button = snap.elements.find((e) => e.tag === "button");
    expect(button?.accessibleName).toBe("Sign in");
    const password = snap.elements.find((e) => e.tag === "input" && e.accessibleName === "Password");
    expect(password?.accessibleName).toBe("Password");
    expect(password?.state?.empty).toBe(true);
  });

  it("extracts an anchor as an interactive link", () => {
    setHtml(`<a href="https://example.com/forgot">Forgot password?</a>`);
    const snap = extractAccessibleDOMSnapshot(document, { snapshotId: "s" });
    const link = snap.elements.find((e) => e.tag === "a");
    expect(link?.interactive).toBe(true);
    expect(link?.role).toBe("link");
    expect(link?.accessibleName).toBe("Forgot password?");
  });
});

describe("sanitization", () => {
  it("never serializes a password input value", () => {
    setHtml(`<input id="pass" type="password" value="secret">`);
    const snap = extractAccessibleDOMSnapshot(document, { snapshotId: "s" });
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain("secret");
    const pass = snap.elements.find((e) => e.role === "textbox");
    expect(pass).toBeDefined();
    expect(pass?.state).toBeDefined();
  });

  it("never serializes a card number value", () => {
    setHtml(`<input id="cc" autocomplete="cc-number" value="4111111111111111">`);
    const snap = extractAccessibleDOMSnapshot(document, { snapshotId: "s" });
    expect(JSON.stringify(snap)).not.toContain("4111111111111111");
  });

  it("excludes hidden inputs entirely", () => {
    setHtml(`<input type="hidden" value="session-token-123">`);
    const snap = extractAccessibleDOMSnapshot(document, { snapshotId: "s" });
    expect(JSON.stringify(snap)).not.toContain("session-token-123");
    expect(snap.elements).toHaveLength(0);
  });

  it("excludes elements inside script/style", () => {
    setHtml(`<script>var code = "secret-token";</script><button>Go</button>`);
    const snap = extractAccessibleDOMSnapshot(document, { snapshotId: "s" });
    expect(JSON.stringify(snap)).not.toContain("secret-token");
  });
});

describe("classifySecretField", () => {
  it("classifies password", () => {
    setHtml(`<input type="password">`);
    expect(classifySecretField(document.querySelector("input")!)).toBe("password");
  });
  it("classifies otp", () => {
    setHtml(`<input autocomplete="one-time-code">`);
    expect(classifySecretField(document.querySelector("input")!)).toBe("otp");
  });
  it("classifies card", () => {
    setHtml(`<input autocomplete="cc-csc">`);
    expect(classifySecretField(document.querySelector("input")!)).toBe("card");
  });
});

describe("shouldExcludeElement", () => {
  it("excludes hidden inputs", () => {
    setHtml(`<input type="hidden">`);
    expect(shouldExcludeElement(document.querySelector("input")!)).toBe(true);
  });
});
