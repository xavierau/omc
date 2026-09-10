ALTER TABLE receipts ADD COLUMN flowforge_job_id TEXT;
CREATE INDEX idx_receipts_flowforge_job_id ON receipts(flowforge_job_id);
