import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Reveal from "../Reveal";
import Stagger from "../Stagger";
import Press from "../Press";

/**
 * The contract these tests defend is one line from the brief: motion may
 * accompany information appearing, it may never gate it. Everything below is a
 * way of asking "is the content still there?" while the animation machinery is
 * broken, absent, or switched off.
 */

let matchMediaReduced = false;

beforeEach(() => {
  matchMediaReduced = false;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion") && matchMediaReduced,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Observes nothing, so an element that goes hidden would stay hidden. */
function stubObserverThatNeverFires() {
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = vi.fn();
      disconnect = disconnect;
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = "";
      thresholds = [];
    }
  );
  return { disconnect };
}

describe("Reveal", () => {
  it("renders its children immediately", () => {
    render(<Reveal>the 09:17 fast to Churchgate</Reveal>);
    expect(screen.getByText("the 09:17 fast to Churchgate")).toBeInTheDocument();
  });

  it("starts shown, so no-JS and server output are both correct", () => {
    // jsdom reports a zero-size rect, which counts as on-screen here — the
    // common case for a one-screen utility, and the one that must not flicker.
    const { container } = render(<Reveal>content</Reveal>);
    expect(container.firstElementChild).toHaveAttribute("data-reveal", "shown");
  });

  it("keeps content visible when IntersectionObserver does not exist", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { container } = render(<Reveal>content</Reveal>);

    expect(screen.getByText("content")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("data-reveal", "shown");
  });

  it("never hides anything under prefers-reduced-motion", () => {
    matchMediaReduced = true;
    stubObserverThatNeverFires();

    const { container } = render(<Reveal>content</Reveal>);
    expect(container.firstElementChild).toHaveAttribute("data-reveal", "shown");
  });

  it("applies an explicit delay as a CSS variable", () => {
    const { container } = render(<Reveal delayMs={180}>content</Reveal>);
    expect(container.firstElementChild).toHaveAttribute(
      "style",
      expect.stringContaining("--reveal-delay: 180ms")
    );
  });

  it("renders as another element when asked", () => {
    const { container } = render(<Reveal as="section">content</Reveal>);
    expect(container.firstElementChild?.tagName).toBe("SECTION");
  });

  it("merges a className", () => {
    const { container } = render(<Reveal className="px-4">content</Reveal>);
    expect(container.firstElementChild).toHaveClass("px-4");
  });
});

/** Direct children of the Stagger wrapper, which is itself `container`'s child. */
function staggerChildren(container: HTMLElement): Element[] {
  return [...(container.firstElementChild?.children ?? [])];
}

describe("Stagger", () => {
  it("ramps its children 60ms apart", () => {
    const { container } = render(
      <Stagger>
        <div>one</div>
        <div>two</div>
        <div>three</div>
      </Stagger>
    );

    const delays = staggerChildren(container).map((el) => el.getAttribute("style"));
    expect(delays[0]).toContain("--reveal-delay: 0ms");
    expect(delays[1]).toContain("--reveal-delay: 60ms");
    expect(delays[2]).toContain("--reveal-delay: 120ms");
  });

  it("honours a custom step", () => {
    const { container } = render(
      <Stagger stepMs={25}>
        <div>one</div>
        <div>two</div>
      </Stagger>
    );

    expect(staggerChildren(container)[1].getAttribute("style")).toContain(
      "--reveal-delay: 25ms"
    );
  });

  it("flattens the ramp so a long list never becomes a wait", () => {
    const { container } = render(
      <Stagger maxSteps={2}>
        <div>a</div>
        <div>b</div>
        <div>c</div>
        <div>d</div>
      </Stagger>
    );

    const delays = staggerChildren(container).map((el) => el.getAttribute("style"));
    expect(delays[2]).toContain("--reveal-delay: 120ms");
    // Past the cap every child shares the last delay rather than climbing.
    expect(delays[3]).toContain("--reveal-delay: 120ms");
  });

  it("preserves a child's own inline style", () => {
    const { container } = render(
      <Stagger>
        <div style={{ color: "red" }}>one</div>
      </Stagger>
    );

    const style = staggerChildren(container)[0].getAttribute("style");
    expect(style).toContain("color: red");
    expect(style).toContain("--reveal-delay");
  });

  it("passes text nodes through without consuming a step", () => {
    const { container } = render(
      <Stagger>
        plain text
        <div>first element</div>
      </Stagger>
    );

    expect(container.textContent).toContain("plain text");
    expect(staggerChildren(container)[0].getAttribute("style")).toContain(
      "--reveal-delay: 0ms"
    );
  });

  it("renders every child even with no children to ramp", () => {
    const { container } = render(<Stagger>{null}</Stagger>);
    expect(container.firstElementChild).toBeInTheDocument();
  });
});

describe("Press", () => {
  it("renders a button carrying the press hook", () => {
    render(<Press>Find my train</Press>);
    const button = screen.getByRole("button", { name: "Find my train" });
    expect(button).toHaveAttribute("data-press");
  });

  it("forwards button props", () => {
    const onClick = vi.fn();
    render(
      <Press type="submit" disabled onClick={onClick}>
        Go
      </Press>
    );

    const button = screen.getByRole("button", { name: "Go" });
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toBeDisabled();
  });

  it("presses an existing element with asChild, adding no DOM", () => {
    const { container } = render(
      <Press asChild className="px-4">
        <a href="/x">Go</a>
      </Press>
    );

    const link = screen.getByRole("link", { name: "Go" });
    expect(link).toHaveAttribute("data-press");
    expect(link).toHaveClass("px-4");
    expect(container.firstElementChild).toBe(link);
  });

  it("is honest about a bad asChild child", () => {
    // Cloning a string would silently drop the behaviour; failing loudly at the
    // call site is better than a button that quietly does not respond.
    expect(() =>
      render(<Press asChild>just text</Press>)
    ).toThrow(/single React element/);
  });
});
