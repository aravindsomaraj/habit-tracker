-- =========================================================
-- HABITS
-- One row = one habit belonging to one authenticated user
-- =========================================================

create table public.habits (
    id uuid primary key default gen_random_uuid(),

    user_id uuid not null
        references auth.users(id)
        on delete cascade,

    name text not null,
    emoji text not null default '🎯',

    target numeric not null
        check (target > 0),

    unit text not null default 'units',

    -- Number of days in the habit plan.
    -- Your current app uses this as a duration, e.g. 30 / 60 / 90.
    days integer not null default 30
        check (days >= 1 and days <= 730),

    start_date date not null default current_date,

    -- e.g. "weight (kg)", "views", "pages read"
    metric text not null default 'value',

    -- Whether the target gradually ramps up.
    ramp boolean not null default true,

    created_at timestamptz not null default now()
);


-- =========================================================
-- HABIT ENTRIES
-- One row = one habit's data for one calendar day
-- =========================================================

create table public.habit_entries (
    id uuid primary key default gen_random_uuid(),

    habit_id uuid not null
        references public.habits(id)
        on delete cascade,

    entry_date date not null,

    done boolean not null default false,
    rest boolean not null default false,

    -- Main value, e.g. 8500 steps / 30 minutes / 15 pages
    value numeric,

    -- Optional secondary metric, e.g. weight / views
    metric numeric,

    -- Later this will contain the Supabase Storage path
    -- for the proof image.
    photo_path text,

    updated_at timestamptz not null default now(),

    -- Only one entry per habit per day.
    unique (habit_id, entry_date)
);


-- =========================================================
-- INDEXES
-- =========================================================

create index habits_user_id_idx
    on public.habits(user_id);

create index habit_entries_habit_id_idx
    on public.habit_entries(habit_id);


-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================

alter table public.habits enable row level security;
alter table public.habit_entries enable row level security;


-- We intentionally turned off "Automatically expose new tables",
-- so explicitly grant only signed-in users access.

revoke all on table public.habits
from anon, authenticated;

revoke all on table public.habit_entries
from anon, authenticated;

grant select, insert, update, delete
on table public.habits
to authenticated;

grant select, insert, update, delete
on table public.habit_entries
to authenticated;


-- =========================================================
-- HABITS RLS POLICIES
-- =========================================================

create policy "Users can view their own habits"
on public.habits
for select
to authenticated
using (
    user_id = (select auth.uid())
);

create policy "Users can create their own habits"
on public.habits
for insert
to authenticated
with check (
    user_id = (select auth.uid())
);

create policy "Users can update their own habits"
on public.habits
for update
to authenticated
using (
    user_id = (select auth.uid())
)
with check (
    user_id = (select auth.uid())
);

create policy "Users can delete their own habits"
on public.habits
for delete
to authenticated
using (
    user_id = (select auth.uid())
);


-- =========================================================
-- HABIT ENTRIES RLS POLICIES
--
-- An entry belongs to a user through its parent habit.
-- =========================================================

create policy "Users can view entries for their own habits"
on public.habit_entries
for select
to authenticated
using (
    exists (
        select 1
        from public.habits
        where habits.id = habit_entries.habit_id
          and habits.user_id = (select auth.uid())
    )
);

create policy "Users can create entries for their own habits"
on public.habit_entries
for insert
to authenticated
with check (
    exists (
        select 1
        from public.habits
        where habits.id = habit_entries.habit_id
          and habits.user_id = (select auth.uid())
    )
);

create policy "Users can update entries for their own habits"
on public.habit_entries
for update
to authenticated
using (
    exists (
        select 1
        from public.habits
        where habits.id = habit_entries.habit_id
          and habits.user_id = (select auth.uid())
    )
)
with check (
    exists (
        select 1
        from public.habits
        where habits.id = habit_entries.habit_id
          and habits.user_id = (select auth.uid())
    )
);

create policy "Users can delete entries for their own habits"
on public.habit_entries
for delete
to authenticated
using (
    exists (
        select 1
        from public.habits
        where habits.id = habit_entries.habit_id
          and habits.user_id = (select auth.uid())
    )
);