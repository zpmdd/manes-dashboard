"""独立测试 Excel 日期、文本标识和公式拒绝规则；不改写工作簿。"""
import datetime
import importlib.util
from pathlib import Path
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('reader', Path(__file__).parents[1] / 'scripts/read-vehicle-excel.py')
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


def cell(value, kind='n', fmt='General'):
    return SimpleNamespace(value=value, data_type=kind, number_format=fmt, coordinate='A2')


assert reader.cell_value(cell('00011', 's'), 'ALARM_CODE') == '00011'
assert reader.cell_value(cell(12, fmt='00000'), 'VEHICLENO') == '00012'
assert reader.cell_value(cell(1), 'PALTE_COLOR') == '1'
assert reader.cell_value(cell(None), 'GEO_ALT') is None
assert reader.cell_value(cell(datetime.datetime(2026, 9, 13), 'd'), 'GPS_DATE') == '2026-09-13 00:00:00.000'
for value, key in [(cell(11), 'ALARM_CODE'), (cell(10**15), 'VEHICLENO'), (cell('=1+1', 'f'), 'GEO_LON'), (cell('#VALUE!', 'e'), 'GPS_SPEED')]:
    try:
        reader.cell_value(value, key)
    except ValueError:
        pass
    else:
        raise AssertionError(f'{key} should be rejected')
print('PASS: Excel 日期、空值、前导零、长标识精度和公式/错误值拒绝')
