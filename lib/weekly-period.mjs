export function weekLabelFromDateUtc(date) {
  const wednesday = new Date(date.getTime());
  wednesday.setUTCDate(wednesday.getUTCDate() + 3 - wednesday.getUTCDay());
  const year = wednesday.getUTCFullYear();
  const month = wednesday.getUTCMonth() + 1;
  const week = Math.floor((wednesday.getUTCDate() - 1) / 7) + 1;
  return `${year}年${month}月${week}周`;
}
