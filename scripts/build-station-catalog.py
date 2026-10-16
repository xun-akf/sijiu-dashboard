"""Convert the reviewed source workbook to an explicit import candidate.

This script never writes dashboard data. Review station aliases and exceptions before publishing.
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

source = Path(sys.argv[1])
target = Path(sys.argv[2])
sheet = openpyxl.load_workbook(source, data_only=True).active
aliases = {
    "佛山创雄华府充电站": "麦电-佛山创雄华府充电站",
    "蔚景云黄埔鱼珠智谷充电站": "黄埔鱼珠智谷充电站",
    "蔚景云麦子酒店快充站": "蔚景云麦子酒店充电站",
    "阳充天鹏酒店充电站": "阳充-天鹏酒店充电站",
    "蔚景云雅悦蓝天酒店超充站": "雅悦蓝天酒店超充站",
}

def parts(value):
    result = []
    for raw in re.findall(r"\{([^{}]*)\}", str(value or "")):
        name = re.search(r"计费名称[：:]\s*([^，,]+)", raw)
        if not name:
            raise ValueError("计费规则缺少名称")
        windows = [
            {"period": period, "rate": float(rate), "times": re.findall(r"\d{1,2}:\d\d-\d{1,2}:\d\d", times)}
            for period, rate, times in re.findall(r"(尖|峰|平|谷|标准电费)[：:]\s*([\d.]+)元/度\s*\(([^)]*)\)", raw)
        ]
        if not windows:
            windows = [
                {"period": "服务费", "rate": float(rate), "times": re.findall(r"\d{1,2}:\d\d-\d{1,2}:\d\d", times)}
                for rate, times in re.findall(r"([\d.]+)元/度\s*\(([^)]*)\)", raw)
            ]
        result.append({"name": name.group(1), "windows": windows})
    return result

result = []
for row in list(sheet.values)[2:]:
    if not row[0]:
        continue
    source_id,name,region,operator,operation,address,power,fast_power,slow_power,guns,fast_guns,slow_guns,_,status,_,electricity,service,opened,_ = row
    profile = {
        "sourceStationId": str(source_id), "name": aliases.get(name,name),
        "sourceName": name, "matchRequiresReview": name in aliases,
        "region": region, "operator": operator, "operationType": operation,
        "address": address, "openedAt": str(opened), "status": status,
        "powerKw": float(power), "fastPowerKw": float(fast_power), "slowPowerKw": float(slow_power),
        "guns": int(guns), "fastGuns": int(fast_guns), "slowGuns": int(slow_guns),
        "tariffs": {"electricity": parts(electricity), "service": parts(service)},
        "effectiveFrom": "2026-10-18",
    }
    if name == "大电锤一心社区充电站":
        profile.update(guns=20,fastGuns=20,slowGuns=0,powerKw=1200,fastPowerKw=1200,slowPowerKw=0)
        profile["tariffs"] = {
            part: [rule for rule in profile["tariffs"][part] if rule["name"] == "一心社区计费（新）"]
            for part in ("electricity","service")
        }
    if name == "蔚景云松潘火车站超充站":
        profile.update(status="正常运行",guns=4,fastGuns=4,slowGuns=0,powerKw=320,fastPowerKw=320,slowPowerKw=0)
    if name == "雅悦蓝天酒店慢充站（地下室负二）":
        profile["matchRequiresReview"] = False
        profile.update(powerKw=469,fastPowerKw=0,slowPowerKw=469,guns=67,fastGuns=0,slowGuns=67)
    if name == "蔚景云中和执法大队充电站":
        profile["status"] = "正常运行"
    profile["matchRequiresReview"] = False
    result.append(profile)

assert len(result)==40
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
