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
  baseline?: { eventId: string; shape: import("./schema.js").Shape };
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
  schema?: { baselineEventId: string; changes: import("./schema.js").SchemaChange[] };
  schemaError?: string;
};

export type Database = {
  inboxes: Inbox[];
  events: WebhookEvent[];
};
