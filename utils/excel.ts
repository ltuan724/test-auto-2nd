import * as XLSX from 'xlsx';
import * as fs from 'fs';

const FILE = 'result.xlsx';

export function appendRow(row: Record<string, any>) {
    let data: Record<string, any>[] = [];

    if (fs.existsSync(FILE)) {
        const wb = XLSX.readFile(FILE);
        const sheet = wb.Sheets['Sheet1'];
        data = sheet ? XLSX.utils.sheet_to_json(sheet) : [];
    }

    const index = data.findIndex(
        r => r.username === row.username && r.step === row.step
    );

    if (index !== -1) {
        data[index] = row; // update
    } else {
        data.push(row); // insert
    }

    const newSheet = XLSX.utils.json_to_sheet(data);
    const newWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWb, newSheet, 'Sheet1');

    XLSX.writeFile(newWb, FILE);
}