export const HELP = `Usage: resend-tui --project <directory> [options]

Read-only terminal mailbox for the Convex Resend component.

Options:
  --project <directory>     Convex project directory (required)
  --deployment <selector>  Convex deployment selector (default: the project's own)
  --component <path>       Mounted component path (default: resend)
  --help                    Show this help
`;
export function parseTerminalOptions(arguments_) {
    let projectDirectory;
    let deployment;
    let component = "resend";
    let help = false;
    const values = {
        "--project": (value) => {
            projectDirectory = value;
        },
        "--deployment": (value) => {
            deployment = value;
        },
        "--component": (value) => {
            component = value;
        },
    };
    for (let index = 0; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        if (argument === "--help" || argument === "-h") {
            help = true;
            continue;
        }
        const assign = values[argument ?? ""];
        if (!assign) {
            throw new Error(`Unknown option: ${argument ?? ""}`);
        }
        const value = arguments_[index + 1];
        if (!value || value.startsWith("--"))
            throw new Error(`${argument} requires a value.`);
        index += 1;
        assign(value);
    }
    if (!help && !projectDirectory)
        throw new Error("--project is required.");
    return {
        component,
        ...(deployment === undefined ? {} : { deployment }),
        help,
        projectDirectory: projectDirectory ?? ".",
    };
}
//# sourceMappingURL=options.js.map