export type PipelineStatus = 'uploaded' | 'ocr_processing' | 'ocr_done' | 'embedding' | 'embedded' | 'extracting' | 'review_ready' | 'failed';

export interface DashboardSummaryResponse {
  documents_by_status: Record<PipelineStatus, number>;
  unresolved_conflict_count: number;
  recent_documents: Array<{
    document_id: string;
    title: string;
    detected_type: 'sustainability_report' | 'energy_bill' | 'hr_report' | 'financial_statement' | 'other';
    category_id: string | null;
    created_at: string;
  }>;
  recent_reports: Array<{
    report_id: string;
    version: number;
    status: 'draft' | 'final';
    language: string;
    generated_at: string;
  }>;
}
