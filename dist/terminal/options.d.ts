import type { MailboxOptions } from "../types.js";
export declare const HELP = "Usage: resend-tui --project <directory> [options]\n\nRead-only terminal mailbox for the Convex Resend component.\n\nOptions:\n  --project <directory>     Convex project directory (required)\n  --deployment <selector>  Convex deployment selector (default: the project's own)\n  --component <path>       Mounted component path (default: resend)\n  --help                    Show this help\n";
export type TerminalOptions = MailboxOptions & {
    help: boolean;
};
export declare function parseTerminalOptions(arguments_: readonly string[]): TerminalOptions;
//# sourceMappingURL=options.d.ts.map