-- Add 'action' column to attestation_record to track submitted|approved per plan requirement
ALTER TABLE attestation_record ADD COLUMN action text NOT NULL DEFAULT 'submitted';
