// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { extractAccessibleDOMSnapshot } from "./extractor";
import { classifySecretField, shouldExcludeElement, isHidden, redactSensitiveRuns } from "./sanitizer";
import type { AccessibleDOMSnapshot } from "@guided-web/protocol";

function setHtml(html: string): void {
  document.open();
  document.write(`<html><head><title>Test</title></head><body>${html}</body></html>`);
  document.close();
}

afterEach(() => {
  document.open();
  document.write("");
  document.close();
});

function snap(html: string, options?: Parameters<typeof extractAccessibleDOMSnapshot>[1]): AccessibleDOMSnapshot {
  setHtml(html);
  return extractAccessibleDOMSnapshot(document, { snapshotId: "snap-1", ...options });
}

function find(s: AccessibleDOMSnapshot, pred: (el: AccessibleDOMSnapshot["elements"][number]) => boolean) {
  return s.elements.find(pred);
}

describe("accessible-name semantics (dom-accessibility-api)", () => {
  it("computes aria-label", () => {
    const s = snap(`<button aria-label="Close dialog">X</button>`);
    expect(find(s, (e) => e.tag === "button")?.accessibleName).toBe("Close dialog");
  });

  it("computes aria-labelledby across multiple references", () => {
    const s = snap(`
      <span id="a">First</span><span id="b">Name</span>
      <button aria-labelledby="a b">ignored</button>
    `);
    expect(find(s, (e) => e.tag === "button")?.accessibleName).toBe("First Name");
  });

  it("computes native <label> (for/id)", () => {
    const s = snap(`<label for="i">Email</label><input id="i" type="email">`);
    expect(find(s, (e) => e.tag === "input")?.accessibleName).toBe("Email");
  });

  it("computes explicit label wrapping (nested label)", () => {
    const s = snap(`<label>Name <input id="n" type="text"></label>`);
    expect(find(s, (e) => e.tag === "input")?.accessibleName).toBe("Name");
  });

  it("computes button text content", () => {
    const s = snap(`<button type="submit">Sign in</button>`);
    expect(find(s, (e) => e.tag === "button")?.accessibleName).toBe("Sign in");
  });

  it("computes image alt", () => {
    const s = snap(`<img alt="Product image A" src="a.png">`);
    expect(find(s, (e) => e.tag === "img")?.accessibleName).toBe("Product image A");
  });

  it("computes link accessible name", () => {
    const s = snap(`<a href="/x">Forgot password?</a>`);
    expect(find(s, (e) => e.tag === "a")?.accessibleName).toBe("Forgot password?");
  });

  it("computes a complex ARIA widget (combobox)", () => {
    const s = snap(`
      <span id="cb">City</span>
      <div role="combobox" aria-expanded="false" aria-labelledby="cb"></div>
    `);
    const cb = find(s, (e) => e.role === "combobox");
    expect(cb?.accessibleName).toBe("City");
    expect(cb?.state?.expanded).toBe(false);
  });
});

describe("roles (dom-accessibility-api getRole)", () => {
  it("maps semantic HTML and ARIA roles", () => {
    const s = snap(`
      <button>B</button>
      <a href="#">L</a>
      <input type="checkbox">
      <input type="radio">
      <div role="dialog">D</div>
      <nav><a href="/">Home</a></nav>
      <img alt="x" src="x.png">
    `);
    expect(find(s, (e) => e.tag === "button")?.role).toBe("button");
    expect(find(s, (e) => e.tag === "a" && e.accessibleName === "L")?.role).toBe("link");
    expect(find(s, (e) => e.role === "checkbox")?.role).toBe("checkbox");
    expect(find(s, (e) => e.role === "dialog")?.role).toBe("dialog");
    expect(find(s, (e) => e.role === "img")?.role).toBe("img");
  });
});

describe("disabled / aria-disabled", () => {
  it("detects the disabled attribute", () => {
    const s = snap(`<button disabled>X</button>`);
    expect(find(s, (e) => e.tag === "button")?.state?.disabled).toBe(true);
  });

  it("detects aria-disabled", () => {
    const s = snap(`<button aria-disabled="true">Y</button>`);
    expect(find(s, (e) => e.tag === "button")?.state?.disabled).toBe(true);
  });

  it("treats an enabled control as not disabled", () => {
    const s = snap(`<button>Z</button>`);
    expect(find(s, (e) => e.tag === "button")?.state?.disabled).toBeUndefined();
  });
});

describe("hidden / inaccessible elements", () => {
  it("excludes display:none controls", () => {
    const s = snap(`<button style="display:none">H</button><button>V</button>`);
    expect(find(s, (e) => e.accessibleName === "H")).toBeUndefined();
    expect(find(s, (e) => e.accessibleName === "V")).toBeDefined();
  });

  it("excludes aria-hidden subtrees", () => {
    const s = snap(`<div aria-hidden="true"><button>Hidden</button></div><button>Visible</button>`);
    expect(find(s, (e) => e.accessibleName === "Hidden")).toBeUndefined();
    expect(find(s, (e) => e.accessibleName === "Visible")).toBeDefined();
  });
});

describe("sanitizer interaction (no secret leakage)", () => {
  it("never serializes a password input value", () => {
    const s = snap(`<input id="pass" type="password" value="secret-value-12">`);
    expect(JSON.stringify(s)).not.toContain("secret-value-12");
    const pass = find(s, (e) => e.role === "textbox");
    expect(pass).toBeDefined();
    expect(pass?.state).toBeDefined();
    // The name is the label, not the value.
    expect(pass?.accessibleName).not.toContain("secret-value-12");
  });

  it("never serializes an OTP value", () => {
    const s = snap(`<input autocomplete="one-time-code" value="123456">`);
    expect(JSON.stringify(s)).not.toContain("123456");
  });

  it("never serializes a card value", () => {
    const s = snap(
      `<label for="cc">Card number</label><input id="cc" autocomplete="cc-number" value="4111111111111111">`,
    );
    const out = JSON.stringify(s);
    expect(out).not.toContain("4111111111111111");
  });

  it("excludes hidden inputs entirely (token fields)", () => {
    const s = snap(`<input type="hidden" value="session-token-123">`);
    expect(JSON.stringify(s)).not.toContain("session-token-123");
  });

  it("redacts sensitive runs in an accessible name defensively", () => {
    expect(redactSensitiveRuns("Card 4111 1111 1111 1111", "card")).not.toMatch(/4111/);
    expect(redactSensitiveRuns("OTP 483920", "otp")).not.toContain("483920");
    expect(redactSensitiveRuns("Email address", "none")).toBe("Email address");
  });
});

describe("extractAccessibleDOMSnapshot structure", () => {
  it("returns a versioned snapshot with page metadata", () => {
    const s = snap(`<h1>Hi</h1><p>Some text</p>`);
    expect(s.schemaVersion).toBe(1);
    expect(s.snapshotId).toBe("snap-1");
    expect(s.page.title).toBe("Test");
    expect(s.visibleText).toEqual(["Hi", "Some text"]);
  });
});

describe("classifySecretField / shouldExcludeElement / isHidden", () => {
  it("classifies password, otp and card", () => {
    setHtml(`<input type="password"><input autocomplete="one-time-code"><input autocomplete="cc-csc">`);
    expect(classifySecretField(document.querySelectorAll("input")[0]!)).toBe("password");
    expect(classifySecretField(document.querySelectorAll("input")[1]!)).toBe("otp");
    expect(classifySecretField(document.querySelectorAll("input")[2]!)).toBe("card");
  });

  it("excludes hidden inputs", () => {
    setHtml(`<input type="hidden">`);
    expect(shouldExcludeElement(document.querySelector("input")!)).toBe(true);
  });

  it("detects hidden elements", () => {
    setHtml(`<button style="display:none">H</button>`);
    expect(isHidden(document.querySelector("button")!)).toBe(true);
  });
});
