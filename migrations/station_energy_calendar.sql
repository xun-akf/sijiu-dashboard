-- Station total electricity is independent of the optional fast/slow detail.
-- A month-only source cannot be split into days or weeks.
create table if not exists public.dashboard_station_energy_calendar (
  station_name text not null references public.dashboard_station_profiles(station_name),
  period_start date not null,
  granularity text not null check (granularity in ('day','month')),
  peak_kwh numeric(15,4),
  high_kwh numeric(15,4),
  flat_kwh numeric(15,4),
  valley_kwh numeric(15,4),
  total_kwh numeric(15,4) not null check (total_kwh >= 0),
  source_name text not null,
  published boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(station_name,period_start,granularity),
  check(granularity='day' or extract(day from period_start)=1),
  check(peak_kwh is null or peak_kwh>=0),
  check(high_kwh is null or high_kwh>=0),
  check(flat_kwh is null or flat_kwh>=0),
  check(valley_kwh is null or valley_kwh>=0)
);
create index if not exists dashboard_station_energy_calendar_period_idx
  on public.dashboard_station_energy_calendar(period_start,granularity,station_name);
alter table public.dashboard_station_energy_calendar enable row level security;
grant select,insert,update on public.dashboard_station_energy_calendar to authenticated;
create policy "station_calendar_read" on public.dashboard_station_energy_calendar
  for select to authenticated using (
    dashboard_private.can_read_station(station_name)
    and (published or (select auth.jwt()->'app_metadata'->>'dashboard_role')='operator')
  );
create policy "station_calendar_insert" on public.dashboard_station_energy_calendar
  for insert to authenticated with check ((select auth.jwt()->'app_metadata'->>'dashboard_role')='operator');
create policy "station_calendar_update" on public.dashboard_station_energy_calendar
  for update to authenticated using ((select auth.jwt()->'app_metadata'->>'dashboard_role')='operator')
  with check ((select auth.jwt()->'app_metadata'->>'dashboard_role')='operator');
