create extension if not exists "uuid-ossp";

create table if not exists assignments (
    id uuid primary key default uuid_generate_v4(),
    title text not null default '',
    subject text not null,
    variant_count integer not null default 1,
    status text not null default 'created',
    source_filename text,
    source_mime_type text,
    source_size_bytes bigint,
    source_path text,
    source_text text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists extraction_runs (
    id uuid primary key default uuid_generate_v4(),
    assignment_id uuid not null references assignments(id) on delete cascade,
    status text not null default 'pending',
    current_step integer not null default 1,
    provider text,
    model text,
    prompt_version text not null,
    step_results jsonb not null default '[]'::jsonb,
    parsed_content jsonb not null default '{}'::jsonb,
    error_message text,
    created_at timestamptz not null default now(),
    started_at timestamptz,
    finished_at timestamptz
);

create index if not exists idx_extraction_runs_assignment_id on extraction_runs(assignment_id);
