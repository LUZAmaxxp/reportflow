// OpenAI-compatible tool schemas for all MCP tools — used by the agentic loop.
// Grok receives these and decides which to call with what arguments.

export const AGENT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_observations",
      description:
        "Search approved ESG observations stored in the company database. " +
        "Use this to find measured data values (emissions, energy, headcount, etc.). " +
        "Always search observations before answering data questions.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Free-text search against observation labels and normalized keys. " +
              "Use domain terms like 'CO2', 'scope 1', 'énergie', 'effectif'.",
          },
          filters: {
            type: "object",
            properties: {
              normalized_key: {
                type: "string",
                description: "Exact normalized key, e.g. 'ghg_scope1_tco2e'.",
              },
              period_start: {
                type: "string",
                description: "ISO date — return observations whose period overlaps after this date.",
              },
              period_end: {
                type: "string",
                description: "ISO date — return observations whose period overlaps before this date.",
              },
              category_id: { type: "string" },
              status: {
                type: "string",
                enum: ["approved", "candidate"],
                description: "Defaults to 'approved'. Use 'candidate' only if explicitly needed.",
              },
            },
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_evidence",
      description:
        "Semantic + keyword hybrid search over uploaded document excerpts (PDFs, reports). " +
        "Use this to find specific text passages, methodologies, or contextual information " +
        "from source documents. Returns text snippets with document titles.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural language query describing what text to look for.",
          },
          top_k: {
            type: "number",
            description: "Maximum number of excerpts to return. Default 5, max 20.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_categories",
      description:
        "Returns the full category tree used to classify observations and documents. " +
        "Use this when you need to understand the reporting structure or filter by sector.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "compute_derivation",
      description:
        "Compute an aggregate metric (sum, average, delta, ratio, count) over a set of " +
        "approved observations. Results are cached by fingerprint. Use this for roll-up " +
        "totals (e.g., total Scope 1+2+3 emissions) when asked for aggregates.",
      parameters: {
        type: "object",
        properties: {
          observation_ids: {
            type: "array",
            items: { type: "string" },
            description: "UUIDs of approved observations to aggregate.",
          },
          operation: {
            type: "string",
            enum: ["sum", "average", "delta", "ratio", "count"],
            description:
              "'sum' adds all values, 'average' computes mean, 'delta' is last minus first, " +
              "'ratio' divides first by second (requires exactly 2), 'count' returns the count.",
          },
          label: {
            type: "string",
            description: "Human-readable label for this derived metric.",
          },
        },
        required: ["observation_ids", "operation"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_preferences",
      description:
        "Retrieve the user's stored style and formatting preferences for report generation. " +
        "Call this at the start of report generation.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_report",
      description:
        "Upload a completed HTML report to storage and persist report metadata. " +
        "Call this once the full HTML report content has been produced.",
      parameters: {
        type: "object",
        properties: {
          html_content: {
            type: "string",
            description: "Complete HTML document string for the report.",
          },
          language: {
            type: "string",
            description: "Language code, e.g. 'fr' or 'en'. Defaults to 'fr'.",
          },
          observation_ids: {
            type: "array",
            items: { type: "string" },
            description: "UUIDs of observations referenced in the report.",
          },
          derivation_result_ids: {
            type: "array",
            items: { type: "string" },
            description: "UUIDs of derivation results referenced in the report.",
          },
          source_report_id: {
            type: "string",
            description: "UUID of the parent report when regenerating.",
          },
          style_snapshot: {
            type: "string",
            description: "JSON-encoded style preferences snapshot from mem0 to apply during regeneration.",
          },
        },
        required: ["html_content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "render_pdf",
      description:
        "Enqueue PDF rendering for a created report and wait for it to complete. " +
        "Always call this after create_report when the user asked for a PDF.",
      parameters: {
        type: "object",
        properties: {
          report_id: {
            type: "string",
            description: "UUID returned by create_report.",
          },
        },
        required: ["report_id"],
      },
    },
  },
] as const;

export type AgentTool = typeof AGENT_TOOLS[number];
