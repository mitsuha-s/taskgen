create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

alter table assignments
    add column if not exists user_id text not null default 'default-user',
    add column if not exists updated_at timestamptz not null default now();

alter table assignments
    alter column subject set default 'english',
    alter column variant_count set default 1,
    alter column title drop not null;

create table if not exists assignment_images (
    id uuid primary key default uuid_generate_v4(),
    assignment_id uuid not null references assignments(id) on delete cascade,
    original_filename text,
    stored_path text not null,
    mime_type text not null,
    size_bytes bigint not null,
    created_at timestamptz not null default now()
);

create unique index if not exists assignment_images_one_per_assignment
    on assignment_images (assignment_id);

alter table extraction_runs
    add column if not exists raw_response text,
    add column if not exists warnings jsonb not null default '[]'::jsonb;

alter table extraction_runs
    alter column current_step set default 1,
    alter column step_results set default '[]'::jsonb,
    alter column parsed_content drop not null,
    alter column parsed_content set default null;

create table if not exists llm_runs (
    id uuid primary key default uuid_generate_v4(),
    task_type text not null,
    provider text not null,
    model text,
    prompt_version text,
    input jsonb,
    raw_output text,
    parsed_output jsonb,
    status text not null,
    error_message text,
    created_at timestamptz not null default now(),
    finished_at timestamptz
);
