-- Additive schema only. Existing dashboard_state and weekly prices remain untouched.
create schema if not exists dashboard_private;

create or replace function dashboard_private.can_read_station(p_station text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    (select auth.jwt()->'app_metadata'->>'dashboard_role') in ('operator','viewer')
    or (
      (select auth.jwt()->'app_metadata'->>'dashboard_role') = 'partner'
      and exists (
        select 1 from public.dashboard_operators o
        join public.dashboard_operator_stations os on os.operator_slug=o.slug
        where o.auth_user_id=(select auth.uid()) and o.is_active
          and o.slug=(select auth.jwt()->'app_metadata'->>'operator_slug')
          and os.station_name=p_station
      )
    )
  );
$$;
revoke all on function dashboard_private.can_read_station(text) from public, anon;
grant usage on schema dashboard_private to authenticated;
grant execute on function dashboard_private.can_read_station(text) to authenticated;

create table if not exists public.dashboard_station_profiles (
  station_name text primary key,
  source_station_id text unique,
  source_name text not null,
  province text,
  city text,
  region text,
  address text,
  operator_name text,
  operation_type text,
  opened_at timestamptz,
  operation_status text,
  power_kw numeric(12,3),
  fast_power_kw numeric(12,3),
  slow_power_kw numeric(12,3),
  guns integer,
  fast_guns integer,
  slow_guns integer,
  published boolean not null default false,
  updated_at timestamptz not null default now(),
  check (guns is null or guns >= 0),
  check (fast_guns is null or fast_guns >= 0),
  check (slow_guns is null or slow_guns >= 0)
);
alter table public.dashboard_station_profiles enable row level security;
grant select, insert, update on public.dashboard_station_profiles to authenticated;
create policy "profiles_read" on public.dashboard_station_profiles
  for select to authenticated using (
    dashboard_private.can_read_station(station_name)
    and (published or (select auth.jwt()->'app_metadata'->>'dashboard_role')='operator')
  );
create policy "profiles_insert" on public.dashboard_station_profiles
  for insert to authenticated with check ((select auth.jwt()->'app_metadata'->>'dashboard_role')='operator');
create policy "profiles_update" on public.dashboard_station_profiles
  for update to authenticated
  using ((select auth.jwt()->'app_metadata'->>'dashboard_role')='operator')
  with check ((select auth.jwt()->'app_metadata'->>'dashboard_role')='operator');

create table if not exists public.dashboard_tariff_versions (
  id bigint generated always as identity primary key,
  station_name text not null references public.dashboard_station_profiles(station_name),
  charging_mode text not null check (charging_mode in ('all','fast','slow')),
  rule_name text not null,
  effective_from date not null,
  effective_until date,
  windows jsonb not null, -- [{start,end,electricity,service,period}]
  published boolean not null default false,
  created_at timestamptz not null default now(),
  check (effective_until is null or effective_until >= effective_from),
  unique (station_name, charging_mode, rule_name, effective_from)
);
alter table public.dashboard_tariff_versions enable row level security;
grant select, insert, update on public.dashboard_tariff_versions to authenticated;
create policy "tariffs_read" on public.dashboard_tariff_versions
  for select to authenticated using (
    dashboard_private.can_read_station(station_name)
    and (published or (select auth.jwt()->'app_metadata'->>'dashboard_role')='operator')
  );
create policy "tariffs_insert" on public.dashboard_tariff_versions
  for insert to authenticated with check ((select auth.jwt()->'app_metadata'->>'dashboard_role')='operator');
create policy "tariffs_update" on public.dashboard_tariff_versions
  for update to authenticated using ((select auth.jwt()->'app_metadata'->>'dashboard_role')='operator')
  with check ((select auth.jwt()->'app_metadata'->>'dashboard_role')='operator');

create table if not exists public.dashboard_mode_import_batches (
  id uuid primary key default gen_random_uuid(),
  imported_by uuid not null default auth.uid(),
  imported_at timestamptz not null default now(),
  source_name text not null,
  source_sha256 text not null,
  field_mapping jsonb not null,
  raw_rows jsonb not null
);
alter table public.dashboard_mode_import_batches enable row level security;
grant select, insert on public.dashboard_mode_import_batches to authenticated;
create policy "mode_batches_read" on public.dashboard_mode_import_batches
  for select to authenticated using ((select auth.jwt()->'app_metadata'->>'dashboard_role')='operator');
create policy "mode_batches_insert" on public.dashboard_mode_import_batches
  for insert to authenticated with check (
    (select auth.jwt()->'app_metadata'->>'dashboard_role')='operator'
    and imported_by=(select auth.uid())
  );

create table if not exists public.dashboard_mode_energy (
  station_name text not null references public.dashboard_station_profiles(station_name),
  charge_date date not null,
  charging_mode text not null check (charging_mode in ('fast','slow')),
  device_key text not null default '',
  peak_kwh numeric(15,4),
  high_kwh numeric(15,4),
  flat_kwh numeric(15,4),
  valley_kwh numeric(15,4),
  total_kwh numeric(15,4) not null check (total_kwh>=0),
  orders integer check (orders is null or orders>=0),
  import_batch_id uuid not null references public.dashboard_mode_import_batches(id),
  published boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (station_name, charge_date, charging_mode, device_key),
  check (peak_kwh is null or peak_kwh>=0),
  check (high_kwh is null or high_kwh>=0),
  check (flat_kwh is null or flat_kwh>=0),
  check (valley_kwh is null or valley_kwh>=0),
  check (peak_kwh is null or high_kwh is null or flat_kwh is null or valley_kwh is null
    or abs(peak_kwh+high_kwh+flat_kwh+valley_kwh-total_kwh)<=0.02)
);
create index if not exists dashboard_mode_energy_period_idx
  on public.dashboard_mode_energy (charge_date, station_name, charging_mode);
alter table public.dashboard_mode_energy enable row level security;
grant select, insert, update on public.dashboard_mode_energy to authenticated;
create policy "mode_energy_read" on public.dashboard_mode_energy
  for select to authenticated using (
    dashboard_private.can_read_station(station_name)
    and (published or (select auth.jwt()->'app_metadata'->>'dashboard_role')='operator')
  );
create policy "mode_energy_insert" on public.dashboard_mode_energy
  for insert to authenticated with check ((select auth.jwt()->'app_metadata'->>'dashboard_role')='operator');
create policy "mode_energy_update" on public.dashboard_mode_energy
  for update to authenticated using ((select auth.jwt()->'app_metadata'->>'dashboard_role')='operator')
  with check ((select auth.jwt()->'app_metadata'->>'dashboard_role')='operator');
