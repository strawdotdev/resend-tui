import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createMailbox, MailboxError } from "../src/index.js";

let projectDirectory: string;
let fixturePath: string;
let callsPath: string;

const summary = {
  _id: "email-1",
  _creationTime: 200,
  from: "sender@example.com",
  to: ["recipient@example.com"],
  subject: "Invitation",
  status: "delivered",
  opened: false,
  clicked: false,
  complained: false,
};

const detail = {
  createdAt: 200,
  finalizedAt: 220,
  from: "sender@example.com",
  to: ["recipient@example.com"],
  replyTo: [],
  subject: "Invitation",
  status: "delivered",
  opened: false,
  complained: false,
  text: "Open https://example.com/invitations/one",
};

async function writeFixture(value: unknown) {
  await writeFile(fixturePath, JSON.stringify(value));
}

beforeEach(async () => {
  projectDirectory = await mkdtemp(join(tmpdir(), "resend-tui-project-"));
  fixturePath = join(projectDirectory, "fixture.json");
  callsPath = join(projectDirectory, "calls.jsonl");
  const convex = join(projectDirectory, "node_modules", "convex");
  await mkdir(join(convex, "bin"), { recursive: true });
  await writeFile(join(projectDirectory, "package.json"), '{"type":"module"}\n');
  await writeFile(
    join(convex, "package.json"),
    JSON.stringify({
      name: "convex",
      type: "module",
      exports: { "./package.json": "./package.json" },
      bin: { convex: "bin/main.js" },
    }),
  );
  await writeFile(
    join(convex, "bin", "main.js"),
    `import {appendFile,readFile} from 'node:fs/promises';
const args=process.argv.slice(2);
await appendFile(process.env.MAILBOX_CALLS_PATH,JSON.stringify(args)+'\\n');
const fixture=JSON.parse(await readFile(process.env.MAILBOX_FIXTURE_PATH,'utf8'));
if(fixture.stderr){process.stderr.write(fixture.stderr);process.exit(1)}
if(fixture.raw!==undefined){process.stdout.write(fixture.raw);process.exit(0)}
if(args[0]==='data'){process.stdout.write(JSON.stringify(fixture.list ?? []));process.exit(0)}
const input=JSON.parse(args.at(-1));
process.stdout.write(JSON.stringify((fixture.details ?? {})[input.emailId] ?? null));
`,
  );
  process.env.MAILBOX_FIXTURE_PATH = fixturePath;
  process.env.MAILBOX_CALLS_PATH = callsPath;
  await writeFixture({ details: { "email-1": detail }, list: [summary] });
});

afterEach(() => {
  delete process.env.MAILBOX_FIXTURE_PATH;
  delete process.env.MAILBOX_CALLS_PATH;
});

describe.sequential("mailbox client", () => {
  test("uses the selected project, deployment, component and bounded snapshot arguments", async () => {
    const mailbox = createMailbox({
      projectDirectory,
      deployment: "dev/test-user",
      component: "email/resend",
    });
    await expect(mailbox.listEmails({ limit: 25 })).resolves.toEqual([
      expect.objectContaining({ id: "email-1", subject: "Invitation" }),
    ]);
    await expect(mailbox.getEmail("email-1")).resolves.toEqual(
      expect.objectContaining({ id: "email-1", text: detail.text }),
    );
    const calls = (await readFile(callsPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls[0]).toEqual([
      "data",
      "emails",
      "--deployment",
      "dev/test-user",
      "--component",
      "email/resend",
      "--limit",
      "25",
      "--order",
      "desc",
      "--format",
      "json",
    ]);
    expect(calls[1]).toEqual([
      "run",
      "--deployment",
      "dev/test-user",
      "--component",
      "email/resend",
      "--codegen",
      "disable",
      "--typecheck",
      "disable",
      "lib:get",
      '{"emailId":"email-1"}',
    ]);
    await expect(mailbox.listEmails({ limit: 501 })).rejects.toThrow(RangeError);
  });

  test("leaves the deployment to the project when none is selected", async () => {
    const mailbox = createMailbox({ projectDirectory });
    await mailbox.listEmails({ limit: 5 });
    const calls = (await readFile(callsPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls.at(-1)).toEqual([
      "data",
      "emails",
      "--component",
      "resend",
      "--limit",
      "5",
      "--order",
      "desc",
      "--format",
      "json",
    ]);
  });

  test("matches recipient, subject and timestamp before returning delivered detail", async () => {
    await writeFixture({
      list: [
        { ...summary, _id: "old", _creationTime: 99 },
        { ...summary, _id: "other", to: ["other@example.com"] },
        summary,
      ],
      details: { "email-1": detail },
    });
    const mailbox = createMailbox({ projectDirectory, deployment: "dev" });
    await expect(
      mailbox.waitForEmail({
        to: "recipient@example.com",
        subject: ["Other", "Invitation"],
        sentAfter: 100,
        timeoutMs: 100,
      }),
    ).resolves.toMatchObject({ id: "email-1", status: "delivered" });
  });

  test.each(["cancelled", "bounced", "failed"] as const)(
    "reports %s delivery as a terminal provider failure",
    async (status) => {
      await writeFixture({
        list: [{ ...summary, status }],
        details: { "email-1": { ...detail, errorMessage: "provider rejected", status } },
      });
      const mailbox = createMailbox({ projectDirectory, deployment: "dev" });
      await expect(
        mailbox.waitForEmail({
          to: "recipient@example.com",
          subject: "Invitation",
          sentAfter: 100,
          timeoutMs: 100,
        }),
      ).rejects.toMatchObject({ code: "delivery_failed" });
    },
  );

  test("distinguishes disappeared messages, timeout and abort", async () => {
    const mailbox = createMailbox({ projectDirectory, deployment: "dev" });
    await writeFixture({ list: [summary], details: {} });
    await expect(
      mailbox.waitForEmail({
        to: "recipient@example.com",
        subject: "Invitation",
        sentAfter: 100,
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject({ code: "message_missing" });

    await writeFixture({ list: [] });
    await expect(
      mailbox.waitForEmail({
        to: "recipient@example.com",
        subject: "Invitation",
        sentAfter: 100,
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ code: "timeout" });

    const controller = new AbortController();
    controller.abort();
    await expect(mailbox.listEmails({ signal: controller.signal })).rejects.toMatchObject({
      code: "aborted",
    });
  });

  test("distinguishes malformed component output and command failures", async () => {
    const mailbox = createMailbox({ projectDirectory, deployment: "dev" });
    await writeFixture({ raw: "" });
    await expect(mailbox.listEmails()).resolves.toEqual([]);
    await writeFixture({ raw: "not-json" });
    await expect(mailbox.listEmails()).rejects.toMatchObject({ code: "invalid_output" });
    await writeFixture({ stderr: "component unavailable" });
    await expect(mailbox.listEmails()).rejects.toMatchObject({
      code: "command_failed",
      message: "component unavailable",
    });
  });

  test("reports a missing consuming Convex dependency as configuration", async () => {
    const empty = await mkdtemp(join(tmpdir(), "resend-tui-empty-"));
    const mailbox = createMailbox({ projectDirectory: empty, deployment: "dev" });
    await expect(mailbox.listEmails()).rejects.toBeInstanceOf(MailboxError);
    await expect(mailbox.listEmails()).rejects.toMatchObject({ code: "configuration" });
  });
});
