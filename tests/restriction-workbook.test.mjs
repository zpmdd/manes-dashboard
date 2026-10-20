import DAOYAN_RESTRICTIONS from '../src/projects/daoyan-restrictions.json' with { type: 'json' };
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { restrictionMembership } from '../src/restrictions.js';
import { restrictionWorkbookBuffer, rowsFromExcelBuffer } from '../src/restrictionWorkbook.js';
import validationRows from '../测试数据/restriction-validation-1000.json' with { type: 'json' };

test('导出 Excel 包含 1000 辆判定结果和完整限行规则', async () => {
  const rows = structuredClone(validationRows), restriction = DAOYAN_RESTRICTIONS[0];
  const buffer = await restrictionWorkbookBuffer(restriction, restrictionMembership(restriction, rows));
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['限行判定结果', '限行规则']);
  const results = workbook.getWorksheet('限行判定结果');
  assert.equal(results.rowCount, 1006); assert.equal(results.getCell('B3').value, 1000);
  assert.equal(results.getCell('E3').value, 800); assert.equal(results.getCell('H3').value, 200);
  assert.equal(results.getCell('H7').value, '范围内'); assert.equal(results.getCell('H1006').value, '范围外');
  assert.equal(workbook.getWorksheet('限行规则').getCell('B5').value, restriction.targets);
});

test('导入 XLSX 能读取车辆行', async () => {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('车辆数据');
  sheet.addRow(['VEHICLENO', 'PALTE_COLOR', 'GEO_LON', 'GEO_LAT', 'GPS_SPEED', 'GPS_DATE']);
  sheet.addRow(['TEST-001', '2', 116.5228, 39.8627, 20, '2026-10-20 08:00:00']);
  const rows = await rowsFromExcelBuffer(await workbook.xlsx.writeBuffer());
  assert.equal(rows.length, 1); assert.equal(rows[0].VEHICLENO, 'TEST-001'); assert.equal(rows[0].GEO_LON, 116.5228);
});

test('Excel 导出包含联合规则判定和真实连续事件，稀疏表头拒绝导入', async () => {
  const { analyzeRestrictionTrajectory } = await import('../src/restrictions.js');
  const restriction = DAOYAN_RESTRICTIONS[0];
  const rows = [0, 1, 2].map(minute => ({ ...validationRows[0], GPS_DATE: `2026-10-20 08:0${minute}:00` }));
  const analysis = analyzeRestrictionTrajectory(restriction, rows);
  const buffer = await restrictionWorkbookBuffer(restriction, restrictionMembership(restriction, rows), analysis);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer);
  assert.equal(workbook.getWorksheet('限行判定结果').getCell('L7').value, '命中规则');
  assert.equal(workbook.getWorksheet('连续命中事件').getCell('E3').value, 3);
  assert.equal(workbook.getWorksheet('连续命中事件').rowCount, 3);
  const sparse = new ExcelJS.Workbook(), sheet = sparse.addWorksheet('车辆');
  sheet.getCell('A1').value = 'VEHICLENO'; sheet.getCell('C1').value = 'GPS_DATE'; sheet.getCell('A2').value = 'TEST';
  await assert.rejects(rowsFromExcelBuffer(await sparse.xlsx.writeBuffer()), /表头不能为空/);
});
