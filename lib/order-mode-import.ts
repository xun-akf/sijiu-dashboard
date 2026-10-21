type Fact={stationName:string;date:string;mode:'fast'|'slow';deviceId:null;peak:number|null;high:number|null;flat:number|null;valley:number|null;charge:number;orders:number};
export function aggregateOrderRows(input:Record<string,string>[],stations:string[],aliases:Record<string,string>) {
 const known=new Set(stations),seen=new Map<string,string>(),groups=new Map<string,Fact>();let duplicateOrders=0,ignoredEnergy=0;
 const fields=['尖时电量','峰时电量','平时电量','谷时电量'] as const;
 const numeric=(raw:string)=>{const n=Number(raw);if(!raw?.trim()||!Number.isFinite(n)||n<0)throw new Error('电量必须为非负实测值');return n;};
 for(const r of input){
  const id=r['服务交易号']||'';if(!id.startsWith('S'))continue;
  const charge=numeric(r['充电总电量']);if(charge===0)continue;
  const date=r['日期']?.slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))throw new Error('订单日期无效');
  const mode=r['充电模式']==='直流'?'fast':r['充电模式']==='交流'?'slow':null;if(!mode)throw new Error('订单充电模式无法识别');
  const signature=JSON.stringify([r['充电站名称'],date,mode,charge,...fields.map(f=>r[f])]);
  if(seen.has(id)){if(seen.get(id)!==signature)throw new Error('重复交易号的电量或模式冲突');duplicateOrders++;continue;}seen.set(id,signature);
  const name=known.has(r['充电站名称'])?r['充电站名称']:aliases[r['充电站名称']];
  if(!name||!known.has(name)){ignoredEnergy+=charge;continue;}
  if(Number(r['深谷电量']||0)!==0)throw new Error('存在深谷电量，需要独立计费配置');
  const key=[name,date,mode].join('|');const g=groups.get(key)||{stationName:name,date,mode,deviceId:null,peak:0,high:0,flat:0,valley:0,charge:0,orders:0};
  g.charge+=charge;g.orders++;
  ['peak','high','flat','valley'].forEach((k,i)=>{g[k as 'peak']!+=numeric(r[fields[i]]);});groups.set(key,g);
 }
 const rawRows=[...groups.values()].map(g=>({...g}));let invalidGroups=0;
 const rows=rawRows.map(g=>{if(Math.abs(g.peak!+g.high!+g.flat!+g.valley!-g.charge)>.02){invalidGroups++;return {...g,peak:null,high:null,flat:null,valley:null};}return {...g};});
 return {rows,rawRows,duplicateOrders,ignoredEnergy,invalidGroups};
}
