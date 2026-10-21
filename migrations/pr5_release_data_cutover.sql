-- Run once as the PR #5 production release reaches READY. Keep the original
-- acceptance snapshot intact and back up both previous formal and draft keys.
begin;
do $check$
begin
  if (select jsonb_array_length(value) from public.dashboard_state where key='station_data_pr5_acceptance') <> 40
     or (select jsonb_array_length(value) from public.dashboard_state where key='station_data_published') <> 18
     or not exists (select 1 from public.dashboard_state where key='configs_pr5_acceptance')
     or not exists (select 1 from public.dashboard_state where key='mode_data_pr5_acceptance') then
    raise exception 'PR #5 data changed or is incomplete; release cutover stopped';
  end if;
end $check$;

insert into public.dashboard_state(key,value,updated_at)
  select key||'_backup_pr5_release_20261021',value,now()
  from public.dashboard_state
  where key in ('station_data_draft','configs_draft','station_data_published','configs_published','mode_data_draft','mode_data_published')
  on conflict(key) do nothing;

with excluded(name) as (values
  ('蔚景云中和执法大队充电站'),('蔚景云浮生半日闲清居充电站'),
  ('蔚景云迎宾路慢充站'),('蔚景云阿嘎山居民宿充电站'),
  ('宜宾市生态环境局充电站')
), station_payload as (
  select coalesce(jsonb_agg(entry.value order by entry.ordinality),'[]'::jsonb) value
  from public.dashboard_state s
  cross join lateral jsonb_array_elements(s.value) with ordinality entry(value,ordinality)
  where s.key='station_data_pr5_acceptance'
    and not exists (select 1 from excluded e where e.name=entry.value->>'name')
), config_payload as (
  select coalesce(jsonb_object_agg(entry.key,entry.value),'{}'::jsonb) value
  from public.dashboard_state s cross join lateral jsonb_each(s.value) entry
  where s.key='configs_pr5_acceptance'
    and not exists (select 1 from excluded e where e.name=entry.key)
), mode_payload as (
  select jsonb_set(jsonb_set(s.value,'{facts}',
    coalesce((select jsonb_agg(f.value) from jsonb_array_elements(s.value->'facts') f(value)
      where not exists (select 1 from excluded e where e.name=f.value->>'stationName')),'[]'::jsonb),true),
    '{tariffs}',coalesce((select jsonb_agg(t.value) from jsonb_array_elements(s.value->'tariffs') t(value)
      where not exists (select 1 from excluded e where e.name=t.value->>'station_name')),'[]'::jsonb),true) value
  from public.dashboard_state s where s.key='mode_data_pr5_acceptance'
)
insert into public.dashboard_state(key,value,updated_at)
  select payload.key,payload.value,now()
  from station_payload st cross join config_payload cfg cross join mode_payload mode,
  lateral (values
    ('station_data_draft',st.value),('station_data_published',st.value),
    ('configs_draft',cfg.value),('configs_published',cfg.value),
    ('mode_data_draft',mode.value),('mode_data_published',mode.value)
  ) payload(key,value)
  on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;

do $check$
begin
  if (select jsonb_array_length(value) from public.dashboard_state where key='station_data_published') <> 35 then
    raise exception 'Expected 35 visible stations after exclusion; release cutover stopped';
  end if;
end $check$;

update public.dashboard_station_profiles p set published=exists (
  select 1 from public.dashboard_state s cross join lateral jsonb_array_elements(s.value) station
  where s.key='station_data_published' and station->>'name'=p.station_name
);
update public.dashboard_tariff_versions t set published=p.published
  from public.dashboard_station_profiles p where t.station_name=p.station_name;
update public.dashboard_station_energy_calendar c set published=p.published
  from public.dashboard_station_profiles p where c.station_name=p.station_name;
update public.dashboard_mode_energy m set published=p.published
  from public.dashboard_station_profiles p where m.station_name=p.station_name;
update public.dashboard_publish_events set published_at=now() where id='current';
commit;
