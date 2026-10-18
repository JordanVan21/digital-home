-- Minimal demo schema: houses → rooms, raw phone scans, designs (planner + budget
-- roadmap) and the shared asset library. JSON columns hold the existing contract
-- shapes (RoomShell, SceneSpec, AssetSpec, roadmap) unchanged; see CONTRACTS.md.

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- A house groups rooms. One multi-room phone scan produces one house.
create table public.houses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null default 'My house',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

-- Original phone upload. Files live in the scan-files bucket under
-- <user_id>/<client_scan_id>/. status doubles as the processing queue.
create table public.scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  house_id uuid,
  client_scan_id uuid not null,
  name text not null,
  captured_at timestamptz not null,
  schema_version int not null,
  room_count int not null default 1,
  files jsonb not null default '{}'::jsonb, -- {"scan.json": "<storage path>", ...}
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'done', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_scan_id),
  unique (id, user_id),
  foreign key (house_id, user_id) references public.houses (id, user_id) on delete set null (house_id)
);

-- One room of a house. shell = RoomShell, original_scene = imported SceneSpec
-- (never overwritten), scene = working SceneSpec the sandbox edits.
-- placement = room-to-house transform {position:[x,y,z], rotation:[x,y,z,w]}.
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  house_id uuid not null,
  scan_id uuid,
  source_room_index int,
  name text not null default 'Room',
  placement jsonb not null default '{"position":[0,0,0],"rotation":[0,0,0,1]}'::jsonb,
  shell jsonb,
  original_scene jsonb,
  scene jsonb,
  revision int not null default 0,
  render_report jsonb, -- per-object asset resolution results from the render agent
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (scan_id, source_room_index),
  foreign key (house_id, user_id) references public.houses (id, user_id) on delete cascade,
  foreign key (scan_id, user_id) references public.scans (id, user_id) on delete set null (scan_id)
);

-- Aesthetic planner output plus its budget roadmap (milestones/purchases as JSON).
create table public.designs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  house_id uuid not null,
  room_id uuid,
  name text not null default 'Design',
  brief jsonb,   -- questionnaire / free text / interpreted DesignBrief
  scene jsonb,   -- proposed SceneSpec
  roadmap jsonb, -- budget, milestones, purchases
  status text not null default 'draft'
    check (status in ('draft', 'proposed', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (house_id, user_id) references public.houses (id, user_id) on delete cascade,
  foreign key (room_id, user_id) references public.rooms (id, user_id) on delete cascade
);

-- Shared asset library. spec is the AssetSpec JSON as-is; other columns are
-- search projections. GLBs live in the public glbs bucket at glb_path.
create table public.assets (
  id uuid primary key,
  spec jsonb not null,
  category text not null,
  title text not null,
  width_m double precision not null,
  height_m double precision not null,
  depth_m double precision not null,
  tags text[] not null default '{}',
  styles text[] not null default '{}',
  glb_path text not null,
  thumbnail_path text,
  price_minor bigint,
  currency text,
  search tsvector generated always as (
    to_tsvector('english', coalesce(spec->>'searchableDescription', title))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scans_status_idx on public.scans (status, created_at);
create index rooms_house_idx on public.rooms (house_id);
create index designs_house_idx on public.designs (house_id);
create index assets_category_idx on public.assets (category);
create index assets_tags_idx on public.assets using gin (tags);
create index assets_search_idx on public.assets using gin (search);

create trigger houses_updated_at before update on public.houses for each row execute function public.set_updated_at();
create trigger scans_updated_at before update on public.scans for each row execute function public.set_updated_at();
create trigger rooms_updated_at before update on public.rooms for each row execute function public.set_updated_at();
create trigger designs_updated_at before update on public.designs for each row execute function public.set_updated_at();
create trigger assets_updated_at before update on public.assets for each row execute function public.set_updated_at();

-- Row level security: owners do everything with their own rows; the asset
-- library is readable by anyone and writable only with the service role.
alter table public.houses enable row level security;
alter table public.scans enable row level security;
alter table public.rooms enable row level security;
alter table public.designs enable row level security;
alter table public.assets enable row level security;

create policy "own houses" on public.houses for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own scans" on public.scans for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rooms" on public.rooms for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own designs" on public.designs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "read assets" on public.assets for select to anon, authenticated using (true);

grant select, insert, update, delete on public.houses, public.scans, public.rooms, public.designs to authenticated;
grant select on public.assets to anon, authenticated;

-- Live status/scene updates for the sandbox (RLS still applies).
alter publication supabase_realtime add table public.scans, public.rooms, public.designs;

-- Storage: private per-user scan files; public-read asset GLBs/thumbnails.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('scan-files', 'scan-files', false, 52428800,
   array['application/json', 'model/vnd.usdz+zip', 'application/octet-stream']),
  ('glbs', 'glbs', true, 52428800,
   array['model/gltf-binary', 'image/webp', 'image/png', 'image/jpeg', 'application/octet-stream']);

create policy "own scan files read" on storage.objects for select to authenticated
  using (bucket_id = 'scan-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own scan files insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'scan-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own scan files update" on storage.objects for update to authenticated
  using (bucket_id = 'scan-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own scan files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'scan-files' and (storage.foldername(name))[1] = auth.uid()::text);
