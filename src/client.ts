import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { MailboxError } from "./errors.js";
import { parseEmailDetail, parseEmailList } from "./parse.js";
import type {
  EmailSummary,
  GetEmailOptions,
  ListEmailsOptions,
  Mailbox,
  MailboxEmail,
  MailboxOptions,
  WaitForEmailOptions,
} from "./types.js";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const POLL_INTERVAL_MS = 1_000;
const FAILED_STATUSES = new Set(["cancelled", "bounced", "failed"]);

type ConvexManifest = { bin?: string | Record<string, string> };
type RunConvex = (arguments_: string[], signal?: AbortSignal) => Promise<string>;
type ResolvedOptions = { component: string; deployment?: string; projectDirectory: string };

const deploymentArguments = ({ deployment }: ResolvedOptions) =>
  deployment === undefined ? [] : ["--deployment", deployment];

function required(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new MailboxError("configuration", `${label} is required.`);
  return normalized;
}

async function resolveConvexCommand(projectDirectory: string) {
  const require = createRequire(resolve(projectDirectory, "package.json"));
  let manifestPath: string;
  try {
    manifestPath = require.resolve("convex/package.json");
  } catch (cause) {
    throw new MailboxError(
      "configuration",
      `Convex is not installed for the project at ${projectDirectory}.`,
      { cause },
    );
  }

  let manifest: ConvexManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ConvexManifest;
  } catch (cause) {
    throw new MailboxError("configuration", "The installed Convex manifest is unreadable.", {
      cause,
    });
  }
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.convex;
  if (!bin) throw new MailboxError("configuration", "The installed Convex CLI has no executable.");
  return resolve(dirname(manifestPath), bin);
}

function commandMessage(cause: unknown) {
  if (typeof cause === "object" && cause !== null && "stderr" in cause) {
    const stderr = String(cause.stderr).trim();
    if (stderr) return stderr;
  }
  return "The mailbox could not read the Convex Resend component.";
}

function aborted(cause: unknown, signal?: AbortSignal) {
  return signal?.aborted || (cause instanceof Error && cause.name === "AbortError");
}

function commandError(cause: unknown, signal?: AbortSignal) {
  if (cause instanceof MailboxError) return cause;
  if (aborted(cause, signal)) {
    return new MailboxError("aborted", "Mailbox read was aborted.", { cause });
  }
  const timedOut =
    typeof cause === "object" && cause !== null && "killed" in cause && cause.killed === true;
  return new MailboxError(
    timedOut ? "command_timeout" : "command_failed",
    timedOut ? "The Convex mailbox command timed out." : commandMessage(cause),
    { cause },
  );
}

function createRunner(projectDirectory: string): RunConvex {
  let convexCommand: Promise<string> | undefined;
  return async (arguments_, signal) => {
    if (signal?.aborted) throw new MailboxError("aborted", "Mailbox read was aborted.");
    convexCommand ??= resolveConvexCommand(projectDirectory);
    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [await convexCommand, ...arguments_],
        {
          cwd: projectDirectory,
          encoding: "utf8",
          maxBuffer: MAX_OUTPUT_BYTES,
          signal,
          timeout: COMMAND_TIMEOUT_MS,
        },
      );
      return stdout.trim();
    } catch (cause) {
      throw commandError(cause, signal);
    }
  };
}

async function listEmails(
  run: RunConvex,
  config: ResolvedOptions,
  { limit = 100, signal }: ListEmailsOptions = {},
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError("Mailbox snapshot size must be between 1 and 500.");
  }
  return parseEmailList(
    await run(
      [
        "data",
        "emails",
        ...deploymentArguments(config),
        "--component",
        config.component,
        "--limit",
        String(limit),
        "--order",
        "desc",
        "--format",
        "json",
      ],
      signal,
    ),
  );
}

async function getEmail(
  run: RunConvex,
  config: ResolvedOptions,
  emailId: string,
  { signal }: GetEmailOptions = {},
) {
  const id = required(emailId, "emailId");
  return parseEmailDetail(
    await run(
      [
        "run",
        ...deploymentArguments(config),
        "--component",
        config.component,
        "--codegen",
        "disable",
        "--typecheck",
        "disable",
        "lib:get",
        JSON.stringify({ emailId: id }),
      ],
      signal,
    ),
    id,
  );
}

function normalizeWait(options: WaitForEmailOptions) {
  const recipient = required(options.to, "to");
  const subjects = (
    typeof options.subject === "string" ? [options.subject] : [...options.subject]
  ).map((value) => required(value, "subject"));
  if (subjects.length === 0) throw new MailboxError("configuration", "subject is required.");
  if (!Number.isFinite(options.sentAfter)) {
    throw new MailboxError("configuration", "sentAfter must be a finite timestamp.");
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new MailboxError("configuration", "timeoutMs must be greater than zero.");
  }
  return {
    deadline: Date.now() + timeoutMs,
    description: subjects.map((value) => `“${value}”`).join(" or "),
    recipient,
    sentAfter: options.sentAfter,
    signal: options.signal,
    subjects,
  };
}

function matches(email: EmailSummary, expected: ReturnType<typeof normalizeWait>) {
  return (
    email.to.includes(expected.recipient) &&
    email.subject !== undefined &&
    expected.subjects.includes(email.subject) &&
    email.createdAt >= expected.sentAfter
  );
}

function requireViableEmail(email: MailboxEmail | null, emailId: string, description: string) {
  if (!email) {
    throw new MailboxError("message_missing", `Email ${emailId} disappeared from the mailbox.`);
  }
  if (FAILED_STATUSES.has(email.status)) {
    const detail = email.errorMessage ? `: ${email.errorMessage}` : ".";
    throw new MailboxError(
      "delivery_failed",
      `${description} reached the terminal status ${email.status}${detail}`,
    );
  }
  return email;
}

async function pause(deadline: number, signal?: AbortSignal) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return;
  try {
    await delay(Math.min(POLL_INTERVAL_MS, remaining), undefined, { signal });
  } catch (cause) {
    throw new MailboxError("aborted", "Mailbox wait was aborted.", { cause });
  }
}

async function waitForEmail(
  list: Mailbox["listEmails"],
  get: Mailbox["getEmail"],
  options: WaitForEmailOptions,
) {
  const expected = normalizeWait(options);
  const readOptions = expected.signal ? { signal: expected.signal } : {};
  let emailId: string | undefined;
  while (Date.now() < expected.deadline) {
    emailId ??= (await list(readOptions)).find((email) => matches(email, expected))?.id;
    if (emailId) {
      const email = requireViableEmail(
        await get(emailId, readOptions),
        emailId,
        expected.description,
      );
      if (email.status === "delivered") return email;
    }
    await pause(expected.deadline, expected.signal);
  }
  throw new MailboxError(
    "timeout",
    `Timed out waiting for ${expected.description} to ${expected.recipient}.`,
  );
}

export function createMailbox(options: MailboxOptions): Mailbox {
  const config = {
    component: required(options.component ?? "resend", "component"),
    ...(options.deployment === undefined
      ? {}
      : { deployment: required(options.deployment, "deployment") }),
    projectDirectory: resolve(required(options.projectDirectory, "projectDirectory")),
  };
  const run = createRunner(config.projectDirectory);
  const list = (options?: ListEmailsOptions) => listEmails(run, config, options);
  const get = (emailId: string, options?: GetEmailOptions) =>
    getEmail(run, config, emailId, options);

  return {
    getEmail: get,
    listEmails: list,
    waitForEmail: (options) => waitForEmail(list, get, options),
  };
}
