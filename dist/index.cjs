"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  MailboxError: () => MailboxError,
  createMailbox: () => createMailbox,
  formatActionUrl: () => formatActionUrl,
  getEmailActionUrl: () => getEmailActionUrl,
  getEmailActionUrls: () => getEmailActionUrls
});
module.exports = __toCommonJS(src_exports);

// src/client.ts
var import_node_child_process = require("node:child_process");
var import_promises = require("node:fs/promises");
var import_node_module = require("node:module");
var import_node_path = require("node:path");
var import_promises2 = require("node:timers/promises");
var import_node_util = require("node:util");

// src/errors.ts
var MailboxError = class extends Error {
  code;
  constructor(code, message, options) {
    super(message, options);
    this.name = "MailboxError";
    this.code = code;
  }
};

// src/types.ts
var EMAIL_STATUSES = [
  "waiting",
  "queued",
  "cancelled",
  "sent",
  "delivered",
  "delivery_delayed",
  "bounced",
  "failed"
];

// src/parse.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readString(record, key) {
  const value = record[key];
  if (typeof value !== "string") fail(`Mailbox response is missing ${key}.`);
  return value;
}
function readOptionalString(record, key) {
  const value = record[key];
  if (value === void 0) return void 0;
  if (typeof value !== "string") fail(`Mailbox response has an invalid ${key}.`);
  return value;
}
function readNumber(record, key) {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`Mailbox response is missing ${key}.`);
  }
  return value;
}
function readBoolean(record, key, fallback) {
  const value = record[key];
  if (value === void 0 && fallback !== void 0) return fallback;
  if (typeof value !== "boolean") fail(`Mailbox response is missing ${key}.`);
  return value;
}
function readStrings(record, key) {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    fail(`Mailbox response has an invalid ${key}.`);
  }
  return value;
}
function readRecipients(record, key) {
  const value = record[key];
  return typeof value === "string" ? [value] : readStrings(record, key);
}
function readStatus(record) {
  const value = record.status;
  if (typeof value !== "string" || !EMAIL_STATUSES.includes(value)) {
    fail("Mailbox response has an unknown delivery status.");
  }
  return value;
}
function fail(message) {
  throw new MailboxError("invalid_output", message);
}
function parseJson(output) {
  try {
    return JSON.parse(output);
  } catch (cause) {
    throw new MailboxError("invalid_output", "Convex returned an unreadable mailbox response.", {
      cause
    });
  }
}
function parseSummary(value) {
  if (!isRecord(value)) fail("Mailbox response contains an invalid email.");
  const subject = readOptionalString(value, "subject");
  return {
    id: readString(value, "id"),
    createdAt: readNumber(value, "createdAt"),
    from: readString(value, "from"),
    to: readRecipients(value, "to"),
    ...subject === void 0 ? {} : { subject },
    status: readStatus(value),
    opened: readBoolean(value, "opened"),
    clicked: readBoolean(value, "clicked", false),
    complained: readBoolean(value, "complained")
  };
}
function parseEmailList(output) {
  if (output.trim() === "") return [];
  const value = parseJson(output);
  if (!Array.isArray(value)) fail("Convex returned an invalid mailbox snapshot.");
  return value.map((email) => {
    if (!isRecord(email)) fail("Mailbox response contains an invalid email.");
    return parseSummary({
      ...email,
      id: readString(email, "_id"),
      createdAt: readNumber(email, "_creationTime")
    });
  });
}
function parseEmailDetail(output, emailId) {
  const value = parseJson(output);
  if (value === null) return null;
  if (!isRecord(value)) fail("Mailbox response contains an invalid email.");
  const optional = {
    resendId: readOptionalString(value, "resendId"),
    errorMessage: readOptionalString(value, "errorMessage"),
    html: readOptionalString(value, "html"),
    text: readOptionalString(value, "text")
  };
  return {
    ...parseSummary({ ...value, id: emailId, createdAt: readNumber(value, "createdAt") }),
    replyTo: readStrings(value, "replyTo"),
    finalizedAt: readNumber(value, "finalizedAt"),
    ...Object.fromEntries(Object.entries(optional).filter((entry) => entry[1] !== void 0))
  };
}

// src/client.ts
var execFileAsync = (0, import_node_util.promisify)(import_node_child_process.execFile);
var COMMAND_TIMEOUT_MS = 1e4;
var MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
var POLL_INTERVAL_MS = 1e3;
var FAILED_STATUSES = /* @__PURE__ */ new Set(["cancelled", "bounced", "failed"]);
var deploymentArguments = ({ deployment }) => deployment === void 0 ? [] : ["--deployment", deployment];
function required(value, label) {
  const normalized = value.trim();
  if (!normalized) throw new MailboxError("configuration", `${label} is required.`);
  return normalized;
}
async function resolveConvexCommand(projectDirectory) {
  const require2 = (0, import_node_module.createRequire)((0, import_node_path.resolve)(projectDirectory, "package.json"));
  let manifestPath;
  try {
    manifestPath = require2.resolve("convex/package.json");
  } catch (cause) {
    throw new MailboxError(
      "configuration",
      `Convex is not installed for the project at ${projectDirectory}.`,
      { cause }
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(await (0, import_promises.readFile)(manifestPath, "utf8"));
  } catch (cause) {
    throw new MailboxError("configuration", "The installed Convex manifest is unreadable.", {
      cause
    });
  }
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.convex;
  if (!bin) throw new MailboxError("configuration", "The installed Convex CLI has no executable.");
  return (0, import_node_path.resolve)((0, import_node_path.dirname)(manifestPath), bin);
}
function commandMessage(cause) {
  if (typeof cause === "object" && cause !== null && "stderr" in cause) {
    const stderr = String(cause.stderr).trim();
    if (stderr) return stderr;
  }
  return "The mailbox could not read the Convex Resend component.";
}
function aborted(cause, signal) {
  return signal?.aborted || cause instanceof Error && cause.name === "AbortError";
}
function commandError(cause, signal) {
  if (cause instanceof MailboxError) return cause;
  if (aborted(cause, signal)) {
    return new MailboxError("aborted", "Mailbox read was aborted.", { cause });
  }
  const timedOut = typeof cause === "object" && cause !== null && "killed" in cause && cause.killed === true;
  return new MailboxError(
    timedOut ? "command_timeout" : "command_failed",
    timedOut ? "The Convex mailbox command timed out." : commandMessage(cause),
    { cause }
  );
}
function createRunner(projectDirectory) {
  let convexCommand;
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
          timeout: COMMAND_TIMEOUT_MS
        }
      );
      return stdout.trim();
    } catch (cause) {
      throw commandError(cause, signal);
    }
  };
}
async function listEmails(run, config, { limit = 100, signal } = {}) {
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
        "json"
      ],
      signal
    )
  );
}
async function getEmail(run, config, emailId, { signal } = {}) {
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
        JSON.stringify({ emailId: id })
      ],
      signal
    ),
    id
  );
}
function normalizeWait(options) {
  const recipient = required(options.to, "to");
  const subjects = (typeof options.subject === "string" ? [options.subject] : [...options.subject]).map((value) => required(value, "subject"));
  if (subjects.length === 0) throw new MailboxError("configuration", "subject is required.");
  if (!Number.isFinite(options.sentAfter)) {
    throw new MailboxError("configuration", "sentAfter must be a finite timestamp.");
  }
  const timeoutMs = options.timeoutMs ?? 3e4;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new MailboxError("configuration", "timeoutMs must be greater than zero.");
  }
  return {
    deadline: Date.now() + timeoutMs,
    description: subjects.map((value) => `\u201C${value}\u201D`).join(" or "),
    recipient,
    sentAfter: options.sentAfter,
    signal: options.signal,
    subjects
  };
}
function matches(email, expected) {
  return email.to.includes(expected.recipient) && email.subject !== void 0 && expected.subjects.includes(email.subject) && email.createdAt >= expected.sentAfter;
}
function requireViableEmail(email, emailId, description) {
  if (!email) {
    throw new MailboxError("message_missing", `Email ${emailId} disappeared from the mailbox.`);
  }
  if (FAILED_STATUSES.has(email.status)) {
    const detail = email.errorMessage ? `: ${email.errorMessage}` : ".";
    throw new MailboxError(
      "delivery_failed",
      `${description} reached the terminal status ${email.status}${detail}`
    );
  }
  return email;
}
async function pause(deadline, signal) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return;
  try {
    await (0, import_promises2.setTimeout)(Math.min(POLL_INTERVAL_MS, remaining), void 0, { signal });
  } catch (cause) {
    throw new MailboxError("aborted", "Mailbox wait was aborted.", { cause });
  }
}
async function waitForEmail(list, get, options) {
  const expected = normalizeWait(options);
  const readOptions = expected.signal ? { signal: expected.signal } : {};
  let emailId;
  while (Date.now() < expected.deadline) {
    emailId ??= (await list(readOptions)).find((email) => matches(email, expected))?.id;
    if (emailId) {
      const email = requireViableEmail(
        await get(emailId, readOptions),
        emailId,
        expected.description
      );
      if (email.status === "delivered") return email;
    }
    await pause(expected.deadline, expected.signal);
  }
  throw new MailboxError(
    "timeout",
    `Timed out waiting for ${expected.description} to ${expected.recipient}.`
  );
}
function createMailbox(options) {
  const config = {
    component: required(options.component ?? "resend", "component"),
    ...options.deployment === void 0 ? {} : { deployment: required(options.deployment, "deployment") },
    projectDirectory: (0, import_node_path.resolve)(required(options.projectDirectory, "projectDirectory"))
  };
  const run = createRunner(config.projectDirectory);
  const list = (options2) => listEmails(run, config, options2);
  const get = (emailId, options2) => getEmail(run, config, emailId, options2);
  return {
    getEmail: get,
    listEmails: list,
    waitForEmail: (options2) => waitForEmail(list, get, options2)
  };
}

// src/links.ts
function decodeHtmlEntities(value) {
  return value.replace(/&(#(?:x[\da-f]+|\d+)|amp|apos|gt|lt|quot);/gi, (match, entity) => {
    const named = {
      amp: "&",
      apos: "'",
      gt: ">",
      lt: "<",
      quot: '"'
    };
    const normalized = entity.toLowerCase();
    if (named[normalized]) return named[normalized];
    const hexadecimal = normalized.startsWith("#x");
    const point = Number.parseInt(normalized.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    if (!Number.isInteger(point) || point < 0 || point > 1114111) return match;
    try {
      return String.fromCodePoint(point);
    } catch {
      return match;
    }
  });
}
function normalizeUrl(candidate) {
  const decoded = decodeHtmlEntities(candidate).replace(/[),.;!?'"]+$/, "");
  try {
    const url = new URL(decoded);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : void 0;
  } catch {
    return void 0;
  }
}
function getEmailActionUrls(email) {
  const candidates = [
    ...email.text?.match(/https?:\/\/[^\s<>"']+/g) ?? [],
    ...email.html?.match(/https?:\/\/[^\s<>"']+/g) ?? []
  ];
  const urls = /* @__PURE__ */ new Set();
  for (const candidate of candidates) {
    const url = normalizeUrl(candidate);
    if (url) urls.add(url);
  }
  return [...urls];
}
function getEmailActionUrl(email, expectedPath) {
  const url = getEmailActionUrls(email).find(
    (candidate) => !expectedPath || new URL(candidate).pathname === expectedPath
  );
  if (!url) {
    const expectation = expectedPath ? ` matching ${expectedPath}` : "";
    throw new Error(`No action URL${expectation} found in \u201C${email.subject ?? "email"}\u201D.`);
  }
  return url;
}
function formatActionUrl(value) {
  const url = new URL(value);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return `${url.host}${path}`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MailboxError,
  createMailbox,
  formatActionUrl,
  getEmailActionUrl,
  getEmailActionUrls
});
//# sourceMappingURL=index.cjs.map
