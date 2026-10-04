# resend-tui

Read email stored by [`@convex-dev/resend`](https://github.com/get-convex/resend) from tests or a terminal. The tool is read-only and does not add a public mailbox endpoint.

## Install

Install a compiled release tag. Consumers do not build this package.

```sh
pnpm add -D '@strawdev/resend-tui@github:strawdotdev/resend-tui#v0.1.2'
```

The consuming Convex project must install `convex` and mount `@convex-dev/resend`. This release is qualified with Convex 1.45.0 and `@convex-dev/resend` 0.2.7.

## Programmatic use

```ts
import { createMailbox, getEmailActionUrl } from "@strawdev/resend-tui";

const mailbox = createMailbox({
  projectDirectory: "/absolute/path/to/convex-project",
  deployment: "dev", // optional: without it, the project's own selection (its .env.local)
  component: "resend", // optional default
});

const email = await mailbox.waitForEmail({
  to: "test@example.com",
  subject: "Your invitation",
  sentAfter: Date.now(),
  timeoutMs: 120_000,
});
const action = getEmailActionUrl(email, "/api/auth/verify-email");
```

`listEmails` reads one bounded component snapshot (1–500 records; 100 by default). This is not pagination. `waitForEmail` matches recipient, subject, and timestamp, then waits for the matched record to become `delivered`. Failures use `MailboxError` codes so tests can distinguish configuration, command, malformed-output, delivery, disappearance, timeout, and cancellation outcomes.

## Terminal

The terminal application requires [Bun](https://bun.sh/) and an interactive terminal. It never opens a link until the user explicitly selects one.

```sh
resend-tui --project ./packages/backend --component resend
```

Run `resend-tui --help` for the full option list.

## Verification and releases

`pnpm verify` runs deterministic checks. `pnpm test:package` and `pnpm test:git` prove that compiled artifacts, declarations, Node imports, and immutable Git-tag installation work without consumer build scripts. `pnpm test:integration` is an explicit development-component proof and requires the environment described by the script.

Releases are created only by manually dispatching the repository's Release workflow. Published tags are immutable.
