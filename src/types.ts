export type SentryEvent = {
  event_id?: string;
  message?: string;
  platform?: string;
  exception?: {
    values?: Array<{
      type?: string;
      value?: string;
      stacktrace?: {
        frames?: Array<{
          filename?: string;
          function?: string;
          lineno?: number;
          colno?: number;
          in_app?: boolean;
        }>;
      };
    }>;
  };
  tags?: Record<string, string> | Array<[string, string]>;
};

export type AggregatedIssue = {
  id: string; // hash
  exception_type: string;
  exception_value: string;
  count: number;
  first_seen: string; // ISO
  last_seen: string; // ISO
  ignore_until?: string | null; // ISO
  payload: SentryEvent;
};

