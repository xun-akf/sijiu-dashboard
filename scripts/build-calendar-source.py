"""Read the two supplied real workbooks and prepare scoped, auditable energy rows."""
import json
import sys
from collections import Counter
from pathlib import Path
from openpyxl import load_workbook

ROOT=Path(__file__).resolve().parents[1]
catalog=json.loads((ROOT/'data/station-catalog-20261018.json').read_text())
aliases={alias:station['name'] for station in catalog for alias in (station['name'],station['sourceName'])}
paths=[Path(arg) for arg in sys.argv[1:]]
if len(paths)!=2:
    raise SystemExit('usage: build-calendar-source.py AUGUST.xlsx SEPTEMBER_DAILY.xlsx')
rows=[]
ignored=Counter()
mismatches=[]
for path,granularity in zip(paths,('month','day')):
    sheet=load_workbook(path,read_only=True,data_only=True).active
    header=list(next(sheet.values))
    expected=['日期','充电站名称','运营商名称','充电量','尖电量','峰电量','平电量','谷电量']
    if header[:8]!=expected:raise ValueError(f'{path.name}: unexpected header {header[:8]}')
    for row in list(sheet.values)[1:]:
        if not row[0] or not row[1]:continue
        name=aliases.get(str(row[1]).strip())
        if not name:
            ignored[str(row[1]).strip()]+=1
            continue
        date=str(row[0]).strip()
        if granularity=='month':
            if len(date)!=7:raise ValueError(f'invalid month {date}')
            date+='-01'
        elif len(date)!=10:raise ValueError(f'invalid day {date}')
        values=[None if x is None else float(x) for x in row[3:8]]
        if values[0] is None:raise ValueError(f'missing total: {name} {date}')
        mismatch=None if any(x is None for x in values[1:]) else round(values[0]-sum(values[1:]),4)
        if mismatch is not None and abs(mismatch)>.02:
            mismatches.append({'station':name,'date':date,'differenceKwh':mismatch})
        rows.append({'station_name':name,'period_start':date,'granularity':granularity,
          'total_kwh':values[0], 'peak_kwh':values[1], 'high_kwh':values[2],
          'flat_kwh':values[3], 'valley_kwh':values[4], 'source_name':path.name})
keys=[(r['station_name'],r['period_start'],r['granularity']) for r in rows]
if len(keys)!=len(set(keys)):raise ValueError('duplicate station/date/granularity in source')
output={'rows':rows,'ignored':ignored,'mismatches':mismatches,'counts':dict(Counter(r['granularity'] for r in rows))}
(ROOT/'data/calendar-source-2026-08-09.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
print(f"rows={len(rows)} counts={output['counts']} ignored={dict(ignored)} mismatches={len(mismatches)}")
