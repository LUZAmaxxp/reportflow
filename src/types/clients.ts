export interface ClientPayload {
  client_id: string;
  company_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at?: string;
}
