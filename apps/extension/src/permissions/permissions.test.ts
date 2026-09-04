import { describe, it, expect } from "vitest";
import { classifyPage, originMatchPattern, displayOrigin } from "./permissions";

describe("classifyPage", () => {
  it("supports http/https origins", () => {
    expect(classifyPage("https://mail.google.com/mail")).toBe("supported");
    expect(classifyPage("http://localhost:8787/health")).toBe("supported");
  });

  it("flags browser-protected pages as protected", () => {
    expect(classifyPage("chrome://extensions")).toBe("protected");
    expect(classifyPage("edge://settings")).toBe("protected");
    expect(classifyPage("chrome-extension://abcdef/index.html")).toBe("protected");
    expect(classifyPage("devtools://devtools/bundled/inspector.html")).toBe("protected");
  });

  it("flags the Chrome Web Store as protected", () => {
    expect(classifyPage("https://chromewebstore.google.com/detail/x")).toBe("protected");
    expect(classifyPage("https://chrome.google.com/webstore/detail/x")).toBe("protected");
  });

  it("degrades unknown/non-http schemes to unsupported", () => {
    expect(classifyPage("file:///tmp/page.html")).toBe("unsupported");
    expect(classifyPage("data:text/html,hello")).toBe("unsupported");
    expect(classifyPage("about:blank")).toBe("protected");
    expect(classifyPage("")).toBe("unsupported");
    expect(classifyPage("not a url")).toBe("unsupported");
  });
});

describe("originMatchPattern", () => {
  it("drops the port and builds a host pattern", () => {
    expect(originMatchPattern("http://localhost:8787/health")).toBe("http://localhost/*");
    expect(originMatchPattern("https://mail.google.com/mail")).toBe("https://mail.google.com/*");
    expect(originMatchPattern("https://example.com:8443/path")).toBe("https://example.com/*");
  });
});

describe("displayOrigin", () => {
  it("returns the hostname for a prompt", () => {
    expect(displayOrigin("https://mail.google.com/mail")).toBe("mail.google.com");
    expect(displayOrigin("http://localhost:8787")).toBe("localhost");
  });
});
