-- Add missing notification_type enum values required by Slice 4: conflict_resolved and pipeline_done
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'conflict_resolved';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'pipeline_done';
