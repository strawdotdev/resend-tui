export declare const EMAIL_STATUSES: readonly ["waiting", "queued", "cancelled", "sent", "delivered", "delivery_delayed", "bounced", "failed"];
export type EmailStatus = (typeof EMAIL_STATUSES)[number];
export type EmailSummary = {
    id: string;
    createdAt: number;
    from: string;
    to: string[];
    subject?: string;
    status: EmailStatus;
    opened: boolean;
    clicked: boolean;
    complained: boolean;
};
export type MailboxEmail = EmailSummary & {
    replyTo: string[];
    finalizedAt: number;
    resendId?: string;
    errorMessage?: string;
    html?: string;
    text?: string;
};
export type MailboxOptions = {
    projectDirectory: string;
    /** A Convex deployment selector; without one the project's own selection is used (its
     * `.env.local`, which may hold a deploy key that `--deployment` cannot be combined with). */
    deployment?: string;
    component?: string;
};
export type ListEmailsOptions = {
    limit?: number;
    signal?: AbortSignal;
};
export type GetEmailOptions = {
    signal?: AbortSignal;
};
export type WaitForEmailOptions = {
    to: string;
    subject: string | readonly string[];
    sentAfter: number;
    timeoutMs?: number;
    signal?: AbortSignal;
};
export type Mailbox = {
    listEmails(options?: ListEmailsOptions): Promise<EmailSummary[]>;
    getEmail(emailId: string, options?: GetEmailOptions): Promise<MailboxEmail | null>;
    waitForEmail(options: WaitForEmailOptions): Promise<MailboxEmail>;
};
//# sourceMappingURL=types.d.ts.map