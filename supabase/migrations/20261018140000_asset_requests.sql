-- Asset requests: the aesthetic planner (or any client) asks the render agent for a
-- model matching an AssetRequest; the worker answers in the same row. Placement is
-- the planner's job; this only returns which library asset (GLB) to use.
--
-- Lifecycle: pending -> processing (asset_id already holds the best library match)
-- -> done (final, possibly edited/built in Blender) | failed.

-- Lets asset_requests enforce that a design belongs to the same user.
alter table public.designs add constraint designs_id_user_unique unique (id, user_id);

create table public.asset_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  room_id uuid,
  design_id uuid,
  object_key text,          -- the caller's own id for the planned object
  request jsonb not null,   -- AssetRequest (packages/contracts/src/assetRequest.ts)
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed')),
  asset_id uuid references public.assets (id),
  asset jsonb,              -- AssetSpec snapshot plus glbUrl (public model URL)
  method text,              -- a = library, b = edited library model, c = built in Blender, placeholder
  source text,              -- render agent outcome source (retrieved, reused, modified, generated, best_effort, placeholder)
  notes jsonb not null default '[]'::jsonb,
  error text,
  seconds real,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (room_id, user_id) references public.rooms (id, user_id) on delete cascade,
  foreign key (design_id, user_id) references public.designs (id, user_id) on delete cascade
);

create index asset_requests_queue_idx on public.asset_requests (status, created_at);
create index asset_requests_design_idx on public.asset_requests (design_id);

create trigger asset_requests_updated_at before update on public.asset_requests
  for each row execute function public.set_updated_at();

-- Owners create and read their requests; only the worker (service role) answers them.
alter table public.asset_requests enable row level security;
create policy "own asset requests read" on public.asset_requests for select to authenticated
  using (user_id = auth.uid());
create policy "own asset requests insert" on public.asset_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and asset_id is null);
create policy "own asset requests delete" on public.asset_requests for delete to authenticated
  using (user_id = auth.uid());
grant select, delete on public.asset_requests to authenticated;
-- Clients may only fill in the request; answer columns stay worker-only.
grant insert (room_id, design_id, object_key, request) on public.asset_requests to authenticated;

alter publication supabase_realtime add table public.asset_requests;
