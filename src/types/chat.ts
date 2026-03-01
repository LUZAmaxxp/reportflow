// Types for chat message content — Slice 5 §5.13

export type UserTextContent = { text: string };
export type AgentTextContent = { text: string };
export type AgentToolCallContent = { tool_name: string; summary: string; details?: Record<string, unknown> };
export type ManualObsPrefilled = { label: string; normalized_key: string; value: string; unit: string | null; period_start: string | null; period_end: string | null; data_type?: "numeric" | "percentage" | "text" | "boolean"; time_behavior?: "periodic" | "point_in_time" | "none"; };
export type ManualObsRequestContent = { pending_id: string; prefilled: ManualObsPrefilled };
export type ReportReadyContent = { report_id: string; title: string; html_snapshot_url: string; pdf_url: string | null };
export type ErrorContent = { message: string; retryable: boolean };
export type ChatMessageContent = UserTextContent | AgentTextContent | AgentToolCallContent | ManualObsRequestContent | ReportReadyContent | ErrorContent;
