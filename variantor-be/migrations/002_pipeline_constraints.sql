alter table extraction_runs alter column current_step set default 0;

do $$
begin
    alter table assignments
        add constraint assignments_variant_count_range
        check (variant_count between 1 and 30);
exception
    when duplicate_object then null;
end $$;

do $$
begin
    alter table extraction_runs
        add constraint extraction_runs_current_step_range
        check (current_step between 0 and 4);
exception
    when duplicate_object then null;
end $$;
