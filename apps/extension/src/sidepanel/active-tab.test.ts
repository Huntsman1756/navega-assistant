// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { resolveActiveTab } from "./active-tab";
import { classifyPage } from "../permissions/permissions";

describe("resolveActiveTab (activeTab / tab.url lifecycle regression)", () => {
  it("uses tab.url directly when present (e.g. activeTab granted via the action icon)", async () => {
    let getFrameCalls = 0;
    const result = await resolveActiveTab(
      async () => ({ id: 7, url: "https://buy.example.com/cart" }),
      async () => {
        getFrameCalls += 1;
        return "https://never.example.com";
      },
    );
    expect(result).toEqual({ id: 7, url: "https://buy.example.com/cart" });
    // The fallback must NOT be consulted when the tab already has a URL.
    expect(getFrameCalls).toBe(0);
  });

  it("falls back to the main frame URL when tab.url is undefined (Side Panel already open / switched tab)", async () => {
    // Mirrors the reported blocker: no tabs permission, so tab.url is undefined.
    const result = await resolveActiveTab(
      async () => ({ id: 123, url: undefined }),
      async (tabId) => {
        expect(tabId).toBe(123);
        return "https://github.com/";
      },
    );
    expect(result).toEqual({ id: 123, url: "https://github.com/" });
    // classifyPage must NOT classify an HTTPS page as unsupported.
    expect(classifyPage(result!.url)).toBe("supported");
  });

  it("degrades to an empty URL (never invents one) if the frame URL is unavailable", async () => {
    const result = await resolveActiveTab(
      async () => ({ id: 9, url: undefined }),
      async () => {
        throw new Error("no webNavigation access");
      },
    );
    expect(result).toEqual({ id: 9, url: "" });
    expect(classifyPage(result!.url)).toBe("unsupported");
  });

  it("returns null when there is no active tab", async () => {
    const result = await resolveActiveTab(async () => null, async () => "x");
    expect(result).toBeNull();
  });
});

describe("classifyPage regression for the reported case", () => {
  it("classifies an ordinary HTTPS page (GitHub) as supported", () => {
    expect(classifyPage("https://github.com/")).toBe("supported");
    expect(classifyPage("https://github.com/Huntsman1756/navega-assistant")).toBe("supported");
  });
});
