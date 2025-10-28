create table if not exists teams (
  team_slug text primary key,
  display_name text not null
);

create table if not exists settings (
  team_slug text references teams(team_slug) on delete cascade,
  total_points int not null default 1000,
  players_needed int not null default 6,
  min_base_per_player int not null default 50,
  primary key (team_slug)
);

do $$ begin
  create type player_status as enum ('pending','won','lost');
exception when duplicate_object then null; end $$;

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  team_slug text references teams(team_slug) on delete cascade,
  name text not null,
  role text not null,
  grade text default 'B',
  rating int default 70,
  base int default 50,
  batting_hand text default null,  -- 'L' or 'R'
  is_wk boolean default false,
  status player_status default 'pending',
  final_bid int
);

create table if not exists roster_constraints (
  id bigserial primary key,
  team_slug text references teams(team_slug) on delete cascade,
  role text default null,
  batting_hand text default null,
  is_wk boolean default null,
  min_count int default 0,
  max_count int default 99
);

alter table teams enable row level security;
alter table settings enable row level security;
alter table players enable row level security;
alter table roster_constraints enable row level security;

create policy public_read_teams on teams for select using (true);
create policy public_read_settings on settings for select using (true);
create policy public_read_players on players for select using (true);
create policy public_read_constraints on roster_constraints for select using (true);

-- Seed team + settings (edit as needed)
insert into teams (team_slug, display_name)
values ('high-range-blasters','High Range Blasters')
on conflict (team_slug) do nothing;

insert into settings (team_slug, total_points, players_needed, min_base_per_player)
values ('high-range-blasters', 1000, 6, 50)
on conflict (team_slug) do update set
  total_points = excluded.total_points,
  players_needed = excluded.players_needed,
  min_base_per_player = excluded.min_base_per_player;

-- Example constraints (you can edit in table view)
insert into roster_constraints (team_slug, role, batting_hand, is_wk, min_count, max_count)
values
  ('high-range-blasters', 'Batsman', 'L', null, 2, 99),
  ('high-range-blasters', 'Wicket Keeper', null, true, 2, 99)
on conflict do nothing;

