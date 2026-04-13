import * as XLSX from 'xlsx';

export function readExcel(filePath: string, sheetName: string = 'Sheet1') {
    const wb = XLSX.readFile(filePath);
    const sheet = wb.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet);
}