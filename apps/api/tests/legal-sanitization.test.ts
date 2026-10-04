import { describe, it, expect } from "vitest";
import { sanitizePolicyContent } from "../src/modules/legal/legal.service.js";

describe("Legal Policy Sanitization (DAIH-QA-01)", () => {
  it("should strip malicious <script> tags", () => {
    const dirty =
      '<h2>Terms of Service</h2><script>alert("XSS")</script><p>Safe text</p>';
    const clean = sanitizePolicyContent(dirty);
    expect(clean).not.toContain("<script>");
    expect(clean).not.toContain('alert("XSS")');
    expect(clean).toContain("<h2>Terms of Service</h2>");
    expect(clean).toContain("<p>Safe text</p>");
  });

  it("should strip inline event handlers like onerror and onload", () => {
    const dirty =
      '<p>Welcome</p><img src="x" onerror="stealCookies()"><a href="javascript:alert(1)">Click</a>';
    const clean = sanitizePolicyContent(dirty);
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("stealCookies");
    expect(clean).not.toContain("javascript:");
  });

  it("should strip inline style tags that could facilitate CSS exfiltration", () => {
    const dirty = '<p style="color:red; background:url(//evil.com)">Text</p>';
    const clean = sanitizePolicyContent(dirty);
    expect(clean).not.toContain("style=");
    expect(clean).not.toContain("//evil.com");
    expect(clean).toContain("<p>Text</p>");
  });

  it("should retain allowed formatting tags and tables safely", () => {
    const valid =
      "<h1>Policy</h1><p>This is <strong>important</strong> and <em>notable</em>.</p><table><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>";
    const clean = sanitizePolicyContent(valid);
    expect(clean).toBe(valid);
  });

  it("should force target=_blank and rel=noopener on links", () => {
    const dirty = '<a href="https://daih.ng/contact">Contact Us</a>';
    const clean = sanitizePolicyContent(dirty);
    expect(clean).toContain('target="_blank"');
    expect(clean).toContain('rel="noopener noreferrer"');
    expect(clean).toContain('href="https://daih.ng/contact"');
  });

  it("should handle empty or whitespace content gracefully", () => {
    expect(sanitizePolicyContent("")).toBe("");
    expect(sanitizePolicyContent("   ")).toBe("");
  });
});
