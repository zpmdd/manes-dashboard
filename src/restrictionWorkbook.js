import { parseSourceContent, validateRows } from './dataSources.js';

const excelModule = async () => {
  const module = await import('exceljs');
  return module.default || module;
};

const excelValue = value => {
  if (value instanceof Date) return value.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
  if (value && typeof value === 'object') {
    if (Object.hasOwn(value, 'result')) return excelValue(value.result);
    if (Array.isArray(value.richText)) return value.richText.map(item => item.text || '').join('');
    if (Object.hasOwn(value, 'text')) return String(value.text);
    throw new Error('表格含有不支持的复合单元格');
  }
  return value ?? '';
};

export async function rowsFromExcelBuffer(buffer) {
  const ExcelJS = await excelModule(), workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) throw new Error('Excel 需要表头和至少一行车辆数据');
  const headers = Array.from({ length: sheet.getRow(1).cellCount }, (_, index) => String(excelValue(sheet.getRow(1).getCell(index + 1).value)).trim());
  if (headers.some(value => !value) || new Set(headers).size !== headers.length) throw new Error('Excel 表头不能为空或重复');
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = headers.map((_, index) => excelValue(row.getCell(index + 1).value));
    if (values.every(value => value === '')) return;
    rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index]])));
  });
  return validateRows(rows);
}

export async function readVehicleFile(file) {
  if (!file) throw new Error('请选择车辆数据文件');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!['json', 'csv', 'xlsx'].includes(extension)) throw new Error('支持 JSON、CSV 和 XLSX 车辆数据');
  if (file.size > 1024 * 1024) throw new Error('导入文件不能超过 1 MB');
  if (extension === 'xlsx') return rowsFromExcelBuffer(await file.arrayBuffer());
  return parseSourceContent(await file.text(), extension);
}

const font = { name: 'Microsoft YaHei', size: 10, color: { argb: 'FF403B36' } };
const headerStyle = cell => {
  cell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF685A4A' } };
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
};

export async function buildRestrictionWorkbook(restriction, membership, trajectory) {
  const ExcelJS = await excelModule(), workbook = new ExcelJS.Workbook();
  workbook.creator = 'MANES'; workbook.created = new Date();
  const results = workbook.addWorksheet('限行判定结果', { views: [{ state: 'frozen', ySplit: 6 }] });
  const inside = membership.filter(item => item.inside).length;
  results.mergeCells('A2:I2'); results.getCell('A2').value = `${restriction.name}限行判定结果`;
  results.getCell('A3').value = '车辆总数'; results.getCell('B3').value = membership.length;
  results.getCell('D3').value = '范围内'; results.getCell('E3').value = inside;
  results.getCell('G3').value = '范围外'; results.getCell('H3').value = membership.length - inside;
  results.getRow(5).values = ['范围：当前时间窗车辆；按 GPS 时间判断，缺少车型/货种时显示信息不足。'];
  results.mergeCells('A5:M5');
  results.getRow(6).values = ['车辆编号', '车辆类型', '货物类型', '经度', '纬度', 'GPS 时间', '速度', '空间判定', '限行区域', '时段命中', '对象命中', '规则判定', '号牌颜色'];
  const state = value => value == null ? '信息不足' : value ? '是' : '否';
  for (const { vehicle, inside: isInside, active, target, status } of membership) results.addRow([
    String(vehicle.VEHICLENO ?? ''), String(vehicle.VEHICLE_TYPE ?? ''), String(vehicle.CARGO_TYPE ?? ''), Number(vehicle.GEO_LON), Number(vehicle.GEO_LAT), String(vehicle.GPS_DATE ?? ''), vehicle.GPS_SPEED == null ? null : Number(vehicle.GPS_SPEED), isInside ? '范围内' : '范围外', restriction.name, state(active), state(target), status, String(vehicle.PALTE_COLOR ?? '')
  ]);
  results.autoFilter = { from: 'A6', to: 'M6' };
  results.getRow(2).height = 26; results.getCell('A2').font = { name: 'Microsoft YaHei', size: 15, bold: true, color: { argb: 'FF3C342E' } };
  results.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left' };
  results.getRow(6).eachCell(headerStyle);
  [16, 15, 13, 14, 14, 22, 10, 12, 24, 12, 12, 14, 12].forEach((width, index) => { results.getColumn(index + 1).width = width; });
  results.getColumn(4).numFmt = '0.000000'; results.getColumn(5).numFmt = '0.000000'; results.getColumn(7).numFmt = '0.0';
  results.eachRow((row, rowNumber) => { if (rowNumber >= 7) { row.height = 20; row.eachCell(cell => { cell.font = font; cell.alignment = { vertical: 'middle' }; cell.border = { bottom: { style: 'hair', color: { argb: 'FFE9E2D6' } } }; }); } });

  const rules = workbook.addWorksheet('限行规则');
  rules.getRow(2).values = ['限行区域', restriction.name]; rules.getRow(3).values = ['限行类型', restriction.type];
  rules.getRow(4).values = ['限行时段', restriction.schedule]; rules.getRow(5).values = ['限行对象', restriction.targets]; rules.getRow(6).values = ['坐标系', restriction.coordinateSystem];
  rules.getRow(8).values = ['顶点', '经度', '纬度']; restriction.boundary.forEach(([longitude, latitude], index) => rules.addRow([`P${index + 1}`, longitude, latitude]));
  [18, 30, 18].forEach((width, index) => { rules.getColumn(index + 1).width = width; }); rules.getRow(8).eachCell(headerStyle);
  rules.getColumn(2).numFmt = '0.000000'; rules.getColumn(3).numFmt = '0.000000';
  if (trajectory) {
    const events = workbook.addWorksheet('连续命中事件', { views: [{ state: 'frozen', ySplit: 2 }] });
    events.getRow(1).values = ['完整已载入批次；至少 3 个不同时刻的命中点，相邻间隔 ≤ 5 分钟；最后命中点不是实际驶离时间。'];
    events.mergeCells('A1:F1');
    events.getRow(2).values = ['车辆编号', '号牌颜色', '开始时间（北京）', '最后命中时间（北京）', '连续点数', '限行区域'];
    const time = value => new Date(value).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
    for (const event of trajectory.events) events.addRow([event.vehicleNo, JSON.parse(event.vehicleKey)[1], time(event.entryTime), time(event.exitTime), event.pointCount, restriction.name]);
    [18, 12, 25, 25, 12, 26].forEach((width, index) => { events.getColumn(index + 1).width = width; });
    events.getRow(2).eachCell(headerStyle);
  }
  return workbook;
}

export async function restrictionWorkbookBuffer(restriction, membership, trajectory) {
  return (await buildRestrictionWorkbook(restriction, membership, trajectory)).xlsx.writeBuffer();
}

export async function downloadRestrictionWorkbook(restriction, membership, trajectory) {
  if (!membership.length) throw new Error('当前没有可导出的车辆数据');
  const buffer = await restrictionWorkbookBuffer(restriction, membership, trajectory);
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a'); link.href = url; link.download = `限行判定结果-${new Date().toISOString().slice(0, 10)}.xlsx`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
