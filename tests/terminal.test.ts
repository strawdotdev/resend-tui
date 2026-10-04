import { describe, expect, test, vi } from "vitest";

import { moveSelection, pageWindow, shutdown } from "../src/terminal/navigation.js";
import { inboxAction, messageAction } from "../src/terminal/keys.js";
import { parseTerminalOptions } from "../src/terminal/options.js";

describe("terminal controls", () => {
  test("parses explicit project, deployment and component selections", () => {
    expect(
      parseTerminalOptions([
        "--project",
        "/tmp/project with spaces",
        "--deployment",
        "dev/user",
        "--component",
        "mail/resend",
      ]),
    ).toEqual({
      component: "mail/resend",
      deployment: "dev/user",
      help: false,
      projectDirectory: "/tmp/project with spaces",
    });
    expect(parseTerminalOptions(["--project", "."]).deployment).toBeUndefined();
    expect(() => parseTerminalOptions([])).toThrow("--project is required");
    expect(() => parseTerminalOptions(["--project", ".", "--unknown"])).toThrow("Unknown option");
  });

  test("bounds page and selection navigation", () => {
    expect(pageWindow(23, 10, 9)).toEqual({ end: 23, page: 2, pageCount: 3, start: 20 });
    expect(moveSelection(0, -1, 3)).toBe(0);
    expect(moveSelection(2, 1, 3)).toBe(2);
    expect(moveSelection(0, 1, 3)).toBe(1);
    expect(inboxAction("pagedown")).toBe("next");
    expect(messageAction("return", true)).toBe("open");
    expect(messageAction("return", false)).toBeUndefined();
  });

  test("destroys the renderer before exiting", () => {
    const destroy = vi.fn();
    const exit = vi.fn();
    shutdown({ destroy }, exit);
    expect(destroy).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
    expect(destroy.mock.invocationCallOrder[0]).toBeLessThan(exit.mock.invocationCallOrder[0]!);
  });
});
