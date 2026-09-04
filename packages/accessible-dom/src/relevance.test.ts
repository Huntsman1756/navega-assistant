// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { orderCandidates, scoreCandidate, applyCharacterBudget } from "./relevance";
import { extractAccessibleDOMSnapshot } from "./extractor";
import type { CandidateAnalysis } from "./relevance";

function cand(p: Partial<CandidateAnalysis>): CandidateAnalysis {
  return {
    domIndex: 0, tag: "button", role: "button", accessibleName: "", interactive: true,
    visible: true, headingLevel: 0, isFocused: false, isAlertOrError: false, isInDialog: false,
    isStateful: false, isLandmark: false, isNavigation: false, isFooterLike: false, isFormField: false,
    dedupeText: "", ...p,
  };
}

function setHtml(html: string): void {
  document.open();
  document.write(`<html><head><title>T</title></head><body>${html}</body></html>`);
  document.close();
}

describe("scoreCandidate determinism", () => {
  it("scores focused > alert > interactive > form-field", () => {
    expect(scoreCandidate(cand({ isFocused: true }))).toBeGreaterThan(scoreCandidate(cand({ isAlertOrError: true })));
    expect(scoreCandidate(cand({ isAlertOrError: true }))).toBeGreaterThan(scoreCandidate(cand({ interactive: true })));
    expect(scoreCandidate(cand({ interactive: true }))).toBeGreaterThan(scoreCandidate(cand({ isFormField: true, interactive: false })));
  });

  it("down-covers hidden and footer/boilerplate", () => {
    expect(scoreCandidate(cand({ visible: false }))).toBeLessThan(0);
    expect(scoreCandidate(cand({ visible: true, interactive: true }))).toBeGreaterThan(scoreCandidate(cand({ isFooterLike: true, accessibleName: "Terms" })));
  });
});

describe("orderCandidates", () => {
  it("lets a relevant late-DOM interactive element survive a budget", () => {
    const candidates: CandidateAnalysis[] = [
      ...Array.from({ length: 300 }, (_, i) =>
        cand({ domIndex: i, tag: "a", role: "link", accessibleName: `Nav item ${i % 5}`, interactive: true, isNavigation: true }),
      ),
      cand({ domIndex: 350, tag: "button", role: "button", accessibleName: "Submit payment", interactive: true }),
    ];
    const order = orderCandidates(candidates, 40);
    expect(order.slice(0, 30).find((r) => r.analysis.accessibleName === "Submit payment")).toBeDefined();
  });

  it("deduplicates repeated text and down-ranks repeats", () => {
    const dupA = cand({ domIndex: 0, accessibleName: "Home", tag: "a", role: "link", isNavigation: true });
    const dupB = cand({ domIndex: 1, accessibleName: "Home", tag: "a", role: "link", isNavigation: true });
    const unique = cand({ domIndex: 2, accessibleName: "Buy now", tag: "button", role: "button" });
    const order = orderCandidates([dupA, dupB, unique], 10);
    expect(order[0]?.analysis.accessibleName).toBe("Buy now");
    expect(order.findIndex((r) => r.analysis.accessibleName === "Home")).toBeGreaterThan(0);
  });

  it("is deterministic for identical input", () => {
    const candidates = [cand({ domIndex: 0, accessibleName: "A" }), cand({ domIndex: 1, accessibleName: "B" })];
    expect(orderCandidates(candidates, 10).map((r) => r.analysis.domIndex)).toEqual(orderCandidates(candidates, 10).map((r) => r.analysis.domIndex));
  });

  it("bounds output to maxElements", () => {
    const candidates = Array.from({ length: 500 }, (_, i) => cand({ domIndex: i, accessibleName: `x${i}` }));
    expect(orderCandidates(candidates, 200).length).toBeLessThanOrEqual(200);
  });
});

describe("applyCharacterBudget", () => {
  it("trims from the end when over budget", () => {
    const ordered = [
      { analysis: cand({ accessibleName: "aaaa" }), score: 700 },
      { analysis: cand({ accessibleName: "bbbb" }), score: 600 },
      { analysis: cand({ accessibleName: "cccc" }), score: 500 },
    ];
    expect(applyCharacterBudget(ordered, 5, (a) => a.accessibleName?.length ?? 0).length).toBeLessThanOrEqual(2);
  });
});

describe("priority semantics", () => {
  it("ranks a visible alert/error above a normal interactive control", () => {
    const error = cand({ domIndex: 10, accessibleName: "Error: el campo es obligatorio", interactive: false, isAlertOrError: true, isFormField: false });
    const normal = cand({ domIndex: 0, accessibleName: "Aceptar", interactive: true });
    const order = orderCandidates([normal, error], 10);
    expect(order[0]?.analysis.accessibleName).toContain("Error");
  });

  it("hidden controls do not outrank visible controls", () => {
    const hiddenAlert = cand({ domIndex: 0, accessibleName: "Hidden alert", isAlertOrError: true, visible: false, interactive: false });
    const visibleButton = cand({ domIndex: 5, accessibleName: "Visible", interactive: true });
    const order = orderCandidates([hiddenAlert, visibleButton], 10);
    expect(order[0]?.analysis.accessibleName).toBe("Visible");
  });

  it("ranks a dialog/modal control at alert priority", () => {
    const dialog = cand({ domIndex: 9, accessibleName: "Confirmar", isInDialog: true, interactive: true });
    const nav = cand({ domIndex: 1, accessibleName: "Home", isNavigation: true, interactive: true });
    const order = orderCandidates([nav, dialog], 10);
    expect(order[0]?.analysis.accessibleName).toBe("Confirmar");
  });
});

describe("extraction-level relevance regression", () => {
  it("keeps the user-relevant button beyond the old DOM cap", () => {
    const noise = Array.from({ length: 400 }, (_, i) => `<li><a href="#i${i}">${i % 5 === 0 ? "Home" : `Section ${i % 7}`}</a></li>`).join("");
    setHtml(`<h1>Checkout</h1><nav><ul>${noise}</ul></nav><button data-target="pay">Pay securely</button>`);
    const s = extractAccessibleDOMSnapshot(document, { snapshotId: "s", maxElements: 200 });
    expect(s.elements.find((e) => e.accessibleName?.toLowerCase().includes("pay securely"))).toBeDefined();
  });

  it("does not let repeated footer/nav crowd out the relevant control", () => {
    const footer = Array.from({ length: 60 }, () => `<footer>Footer Legal Terms Privacy</footer>`).join("");
    setHtml(`${footer}<button>Checkout now</button>`);
    const s = extractAccessibleDOMSnapshot(document, { snapshotId: "s", maxElements: 40 });
    expect(s.elements.find((e) => e.accessibleName?.toLowerCase().includes("checkout now"))).toBeDefined();
    expect(s.elements.filter((e) => e.tag === "footer").length).toBeLessThan(3);
  });

  it("ranks a focused control first", () => {
    setHtml(`<button>Other</button><input id="f" value="x" autofocus><label for="f">Focus me</label>`);
    (document.getElementById("f") as HTMLInputElement).focus();
    const s = extractAccessibleDOMSnapshot(document, { snapshotId: "s" });
    expect(s.elements.find((e) => e.state?.focused)?.accessibleName).toBe("Focus me");
  });
});
