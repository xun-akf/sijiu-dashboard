-- Apply with the PR #5 production release. Partner reads remain restricted to
-- authorized stations, including the supplemental mode detail.
create or replace function public.publish_dashboard_state()
returns void language plpgsql set search_path to '' as $function$
begin
  if auth.uid() is null or auth.jwt()->'app_metadata'->>'dashboard_role'<>'operator' then
    raise exception 'not authorized' using errcode='42501';
  end if;
  insert into public.dashboard_state(key,value,updated_at)
    select replace(key,'_draft','_published'),value,now()
    from public.dashboard_state
    where key in ('station_data_draft','configs_draft','mode_data_draft')
    on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
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
end; $function$;

create or replace function public.read_partner_dashboard_state()
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  requested_operator text := auth.jwt()->'app_metadata'->>'operator_slug';
  station_data jsonb; config_data jsonb; mode_data jsonb;
  operator_row public.dashboard_operators%rowtype;
begin
  if auth.uid() is null or auth.jwt()->'app_metadata'->>'dashboard_role' <> 'partner' or requested_operator is null then
    raise exception 'not authorized' using errcode='42501';
  end if;
  select * into operator_row from public.dashboard_operators
  where slug=requested_operator and is_active and auth_user_id=auth.uid();
  if not found then raise exception 'account disabled or unknown' using errcode='42501'; end if;

  select coalesce(jsonb_agg(item order by item->>'name'),'[]'::jsonb) into station_data
  from public.dashboard_state s cross join lateral jsonb_array_elements(s.value) item
  where s.key='station_data_published' and exists (
    select 1 from public.dashboard_operator_stations os
    where os.operator_slug=requested_operator and os.station_name=item->>'name'
  );
  select coalesce(jsonb_object_agg(entry.key,entry.value),'{}'::jsonb) into config_data
  from public.dashboard_state s cross join lateral jsonb_each(s.value) entry
  where s.key='configs_published' and (entry.key='__monthly__' or exists (
    select 1 from public.dashboard_operator_stations os
    where os.operator_slug=requested_operator and os.station_name=entry.key
  ));

  select value into mode_data from public.dashboard_state where key='mode_data_published';
  mode_data := jsonb_build_object(
    'facts', coalesce((select jsonb_agg(f.value) from jsonb_array_elements(coalesce(mode_data->'facts','[]'::jsonb)) f(value)
      where exists (select 1 from public.dashboard_operator_stations os where os.operator_slug=requested_operator and os.station_name=f.value->>'stationName')),'[]'::jsonb),
    'tariffs', coalesce((select jsonb_agg(t.value) from jsonb_array_elements(coalesce(mode_data->'tariffs','[]'::jsonb)) t(value)
      where exists (select 1 from public.dashboard_operator_stations os where os.operator_slug=requested_operator and os.station_name=t.value->>'station_name')),'[]'::jsonb),
    'fastUnallocated', case when exists (
      select 1 from public.dashboard_operator_stations os where os.operator_slug=requested_operator
      and os.station_name=mode_data->'fastUnallocated'->>'stationName'
    ) then mode_data->'fastUnallocated' else null end
  );
  return jsonb_build_object('stationData',station_data,'configs',config_data,
    'modeData',mode_data,'operator',requested_operator,
    'operatorName',operator_row.display_name,'reportName',operator_row.report_name);
end; $function$;
