export function weekLabelFromDateUtc(date) {
  const sunday = new Date(date.getTime());
  sunday.setUTCDate(sunday.getUTCDate() - sunday.getUTCDay());
  const year = sunday.getUTCFullYear();
  const month = sunday.getUTCMonth() + 1;
  const day = sunday.getUTCDate();
  const firstDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return `${year}年${month}月${Math.floor((day + firstDay - 1) / 7) + 1}周`;
}
