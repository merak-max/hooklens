export type SignatureResult = {
  provided: boolean;
  valid: boolean;
};

export type Inbox = {
  id: string;
  name: string;
  key: string;
  secret: string;
  createdAt: string;
};

export type WebhookEvent = {
  id: string;
  inboxId: string;
  method: string;
  path: string;
  query: Record<string, string | string[]>;
  headers: Record<string, string>;
  body: unknown;
  rawBody: string;
  contentType: string;
  receivedAt: string;
  signature: SignatureResult;
};

export type Database = {
  inboxes: Inbox[];
  events: WebhookEvent[];
};
