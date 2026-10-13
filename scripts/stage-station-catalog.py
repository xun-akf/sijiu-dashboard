"""Generate reviewed, idempotent SQL staging from station-catalog JSON.

Only apply after comparing the emitted SQL and preserving existing dashboard_state.
"""
import json
import sys
from pathlib import Path

catalog = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
output = Path(sys.argv[2])

def literal(value):
    if value is None: return "null"
    if isinstance(value, bool): return "true" if value else "false"
    if isinstance(value, (int,float)): return str(value)
    return "'" + str(value).replace("'","''") + "'"

def minutes(time):
    h,m = map(int,time.split(":"))
    total=h*60+m
    if total<0 or total>1440: raise ValueError(time)
    return total

def slot(rules):
    result=[]
    for rule in rules:
        for window in rule["windows"]:
            for span in window["times"]:
                start,end=span.split("-")
                a,b=minutes(start),minutes(end)
                if a>=b: raise ValueError((rule["name"],span))
                result.append((a,b,window["rate"],window["period"]))
    return result

def tariff_windows(electric,service):
    e,s=slot([electric]),slot([service])
    bounds=sorted({0,1440,*[a for a,_,_,_ in e],*[b for _,b,_,_ in e],*[a for a,_,_,_ in s],*[b for _,b,_,_ in s]})
    windows=[]
    for a,b in zip(bounds,bounds[1:]):
        ep=[x for x in e if x[0]<=a and x[1]>=b]
        sp=[x for x in s if x[0]<=a and x[1]>=b]
        if len(ep)!=1 or len(sp)!=1: raise ValueError(f"{electric['name']}: time {a}-{b} electric={len(ep)} service={len(sp)}")
        windows.append({"start":f"{a//60:02d}:{a%60:02d}","end":f"{b//60:02d}:{b%60:02d}",
                        "period":ep[0][3],"electricity":ep[0][2],"service":sp[0][2]})
    return windows

lines=["begin;"]
for item in catalog:
    if item["matchRequiresReview"]: raise ValueError(item["sourceName"])
    fields=["station_name","source_station_id","source_name","province","city","region","address","operator_name","operation_type",
            "opened_at","operation_status","power_kw","fast_power_kw","slow_power_kw","guns","fast_guns","slow_guns","published"]
    address=item["address"]
    province=address[:2] if address.startswith(("四川","广东","浙江","贵州")) else None
    # Province/city extraction is deliberately conservative; do not guess beyond the given address.
    city=None
    for marker in ("成都市","阿坝藏族羌族自治州","雅安市","乐山市","甘孜藏族自治州","佛山市","广州市","温州市","铜仁市","宜宾市","揭阳市"):
        if marker in address: city=marker;break
    values=[item["name"],item["sourceStationId"],item["sourceName"],province,city,item["region"],address,item["operator"],item["operationType"],
            item["openedAt"],item["status"],item["powerKw"],item["fastPowerKw"],item["slowPowerKw"],item["guns"],item["fastGuns"],item["slowGuns"],False]
    updates=", ".join(f"{x}=excluded.{x}" for x in fields[1:-1])
    lines.append(f"insert into public.dashboard_station_profiles ({','.join(fields)}) values ({','.join(map(literal,values))}) on conflict (station_name) do update set {updates},updated_at=now();")
    erules=item["tariffs"]["electricity"]
    srules={x["name"]:x for x in item["tariffs"]["service"]}
    for erule in erules:
        name=erule["name"]
        if name not in srules: raise ValueError(f"{item['name']}: no matching service rule {name}")
        mode="fast" if "快充" in name else "slow" if "慢充" in name else "all"
        windows=tariff_windows(erule,srules[name])
        values=[item["name"],mode,name,item["effectiveFrom"],json.dumps(windows,ensure_ascii=False,separators=(",",":"))]
        lines.append("insert into public.dashboard_tariff_versions (station_name,charging_mode,rule_name,effective_from,windows,published) "+
                     f"values ({','.join(map(literal,values[:-1]))},{literal(values[-1])}::jsonb,false) "+
                     "on conflict (station_name,charging_mode,rule_name,effective_from) do update set windows=excluded.windows;")
lines.append("commit;")
output.write_text("\n".join(lines)+"\n",encoding="utf-8")
print(f"Staged {len(catalog)} profiles and {sum(len(x['tariffs']['electricity']) for x in catalog)} tariffs")
