-- +goose Up
ALTER TABLE extraction_runs
    ADD COLUMN current_step INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN step_results JSONB NOT NULL DEFAULT '[]'::jsonb;

-- +goose Down
ALTER TABLE extraction_runs
    DROP COLUMN IF EXISTS step_results,
    DROP COLUMN IF EXISTS current_step;
