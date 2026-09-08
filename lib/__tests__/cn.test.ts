import { describe, expect, it } from "vitest";
import { cn } from "@/lib/cn";

describe("cn", () => {
  it("joins plain class names", () => {
    expect(cn("rounded-xl", "px-4")).toBe("rounded-xl px-4");
  });

  it("drops falsy values", () => {
    expect(cn("px-4", false, null, undefined, "", "py-2")).toBe("px-4 py-2");
  });

  it("takes conditionals as objects and arrays", () => {
    expect(cn({ "border-red-500": true, "border-hairline": false })).toBe(
      "border-red-500"
    );
    expect(cn(["flex", ["items-center"]])).toBe("flex items-center");
  });

  it("resolves a Tailwind conflict in favour of the last class", () => {
    // The whole reason this helper exists: a template literal would emit both
    // and leave the winner to stylesheet order.
    expect(cn("px-4", "px-8")).toBe("px-8");
    expect(cn("text-ink", "text-magenta")).toBe("text-magenta");
  });

  it("keeps a conditional override from being cancelled by the base", () => {
    const invalid = true;
    expect(cn("border-hairline", invalid && "border-magenta")).toBe(
      "border-magenta"
    );
  });

  it("leaves non-conflicting utilities alone", () => {
    expect(cn("px-4", "py-4")).toBe("px-4 py-4");
    expect(cn("bg-night", "text-ink")).toBe("bg-night text-ink");
  });

  it("returns an empty string for no input", () => {
    expect(cn()).toBe("");
    expect(cn(undefined)).toBe("");
  });
});
