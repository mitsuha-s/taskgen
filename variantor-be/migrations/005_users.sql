create table if not exists users (
    id text primary key,
    email text not null unique,
    password_hash text not null,
    created_at timestamptz not null default now()
);

create index if not exists idx_assignments_user_created
    on assignments (user_id, created_at desc);
