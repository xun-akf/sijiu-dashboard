-- Apply only with the matching application release. Earlier weekly publishing must
-- not expose staged station profiles or prices before the preview is accepted.
create or replace function public.publish_dashboard_state()
returns void language plpgsql set search_path to '' as $function$
begin
  if auth.uid() is null or auth.jwt()->'app_metadata'->>'dashboard_role'<>'operator' then
    raise exception 'not authorized' using errcode='42501';
  end if;
  insert into public.dashboard_state(key,value,updated_at)
    select replace(key,'_draft','_published'),value,now()
    from public.dashboard_state where key in ('station_data_draft','configs_draft')
    on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
  update public.dashboard_station_profiles set published=true where not published;
  update public.dashboard_tariff_versions set published=true where not published;
  update public.dashboard_station_energy_calendar set published=true where not published;
  update public.dashboard_mode_energy set published=true where not published;
  update public.dashboard_publish_events set published_at=now() where id='current';
end; $function$;
