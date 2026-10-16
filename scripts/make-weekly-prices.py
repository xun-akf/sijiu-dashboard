"""Translate unambiguous 2026-10-18 tariff rules to the legacy week-price input.

Mixed fast/slow tariffs are deliberately excluded: aggregate weekly energy cannot
be priced accurately until real category data is imported.
"""
import json
import sys
from pathlib import Path

catalog=json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
result={}
periods={"峰":"high","平":"flat","谷":"valley","尖":"peak","标准电费":"all"}

def rates(rules):
    if len(rules)!=1: return None
    out={}
    for window in rules[0]["windows"]:
        key=periods.get(window["period"],"all")
        if key in out and out[key]!=window["rate"]: return None
        out[key]=window["rate"]
    return {key:"" if key=="peak" and key not in out else str(out.get(key,out.get("all",""))) for key in ("peak","high","flat","valley")}

for station in catalog:
    electricity=rates(station["tariffs"]["electricity"])
    # Services lack peak labels, but periods are assigned by matching the time windows
    # to the electricity period. Reconstruct from the validated combined tariff windows.
    if electricity is None: continue
    e=station["tariffs"]["electricity"][0]
    s=station["tariffs"]["service"][0]
    minutes={}
    for rule in s["windows"]:
        for span in rule["times"]:
            start,end=span.split("-")
            a=int(start.split(":")[0])*60+int(start.split(":")[1])
            b=int(end.split(":")[0])*60+int(end.split(":")[1])
            for minute in range(a,b): minutes[minute]=rule["rate"]
    service={}
    for entry in e["windows"]:
        key=periods[entry["period"]]
        for span in entry["times"]:
            start,end=span.split("-")
            a=int(start.split(":")[0])*60+int(start.split(":")[1])
            b=int(end.split(":")[0])*60+int(end.split(":")[1])
            values={minutes.get(minute) for minute in range(a,b)}
            if len(values)!=1 or None in values: service=None;break
            value=values.pop()
            if key in service and service[key]!=value: service=None;break
            service[key]=value
        if service is None: break
    if service is None:continue
    service={key:"" if key=="peak" and key not in service else str(service.get(key,service.get("all",""))) for key in ("peak","high","flat","valley")}
    total={key:str(float(electricity[key])+float(service[key])) if electricity[key] and service[key] else "" for key in electricity}
    result[station["name"]]={"electricity":electricity,"service":service,"external":total}

Path(sys.argv[2]).write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(f"{len(result)} of {len(catalog)} stations have unambiguous weekly rate; the rest require separate mode/transaction data")
