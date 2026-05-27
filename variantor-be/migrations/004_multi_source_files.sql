drop index if exists assignment_images_one_per_assignment;

alter table assignment_images
    add column if not exists position integer not null default 1;

create index if not exists idx_assignment_images_assignment_position
    on assignment_images (assignment_id, position, created_at);
