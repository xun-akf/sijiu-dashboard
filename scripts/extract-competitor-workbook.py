"""Extract verified competitor rows from the supplied two-sheet workbook.

This creates a versioned code asset; it never connects to Supabase.
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

PERIODS = ("peak", "high", "flat", "valley")


def price(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
        return str(value)
    return ""


def extract(path):
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    result = {}
    for sheet in book:
        rows = list(sheet.values)
        headings = [i for i, row in enumerate(rows) if row[0] == "周边竞站数据"] if sheet.title == "Sheet2" else list(range(0, len(rows), 16))
        for start in headings:
            row = rows[start]
            own_col = 3 if sheet.title == "Sheet2" else None
            name = str(row[own_col] if own_col is not None else row[0]).strip()
            if not name:
                continue
            # These legacy sheet labels differ from the actual dashboard catalog.
            name = {"佛山创雄华府充电站": "麦电-佛山创雄华府充电站",
                    "蔚景云汉城酒店充电站": "蔚景云汉诚酒店充电站",
                    "彩虹市场慢充站（充电免停15小时）": "彩虹市场慢充站(充电免停15小时)"}.get(name, name)
            if name in ("蔚景云创新中心充电站", "蔚景云华阳物流园一期", "蔚景云华阳物流园二期"):
                continue  # Explicitly removed from the weekly dashboard.
            records = []
            for col in range(2 if own_col is None else 4, len(row)):
                title = row[col]
                if not isinstance(title, str) or not title.strip() or re.match(r"^竞站(?:[A-Z]|ID)?$", title.strip()):
                    continue
                if "建议调整价" in title or "供电局电价" in title:
                    continue
                electricity = {p: price(rows[start + 3 + offset][col]) for offset, p in enumerate(PERIODS)}
                service = {p: price(rows[start + 7 + offset][col]) for offset, p in enumerate(PERIODS)}
                total = {p: price(rows[start + 11 + offset][col]) for offset, p in enumerate(PERIODS)}
                if not any(electricity.values()) and not any(service.values()) and not any(total.values()):
                    continue
                distance_match = re.search(r"[（(](\d+(?:\.\d+)?)\s*m[）)]", title, re.I)
                records.append({"name": title.strip(), "distance": distance_match.group(1) + "m" if distance_match else "",
                                "guns": "",  # The worksheet counts DC devices, not charging guns.
                                "dcDevices": str(rows[start + 2][col]) if isinstance(rows[start + 2][col], (int, float)) else "",
                                "electricity": electricity, "service": service, "total": total})
            if name in result:
                # Sheet1 is the newer source for its 11 stations; sheet2 can
                # contribute additional named competitors without replacing it.
                known = {r["name"] for r in result[name]}
                result[name].extend(r for r in records if r["name"] not in known)
            else:
                result[name] = records
    return result


if __name__ == "__main__":
    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    data = extract(source)
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(f"stations={len(data)} competitors={sum(map(len, data.values()))} empty={sum(not v for v in data.values())}")
