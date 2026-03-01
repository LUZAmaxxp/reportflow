export interface PreferencesResponse {
  scope: string;
  preferences: {
    language?: string;
    tone?: string;
    layout?: string;
    section_order?: string[];
    style_rules?: string[];
  };
}
