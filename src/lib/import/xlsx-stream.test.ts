import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { streamWorkbook } from './xlsx-stream';

const temporaryDirectories: string[] = [];

async function workbookFile(entries: Record<string, string>, extension = '.xlsx') {
  const directory = await mkdtemp(path.join(tmpdir(), 'xlsx-safety-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, `workbook${extension}`);
  await writeFile(filePath, zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)]))));
  return filePath;
}

function baseEntries(relationshipExtra = '', rowAttributes = '', formula = ''): Record<string, string> {
  return {
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Facilities" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/>${relationshipExtra}</Relationships>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet><sheetData><row r="1" ${rowAttributes}>${formula ? `<c r="A1" t="str">${formula}<v>04330</v></c>` : '<c r="A1" t="inlineStr"><is><t>Zip Code</t></is></c>'}</row></sheetData></worksheet>`,
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('XLSX package safety', () => {
  it('rejects macro-enabled extensions before reading the package', async () => {
    const filePath = await workbookFile(baseEntries(), '.xlsm');
    await expect(streamWorkbook(filePath, { wantedSheets: new Set(), onRow: () => undefined }))
      .rejects.toThrow('Only macro-free .xlsx files are accepted');
  });

  it('rejects embedded macros and external workbook relationships', async () => {
    const macroPath = await workbookFile({ ...baseEntries(), 'xl/vbaProject.bin': 'unsafe' });
    await expect(streamWorkbook(macroPath, { wantedSheets: new Set(), onRow: () => undefined }))
      .rejects.toThrow('unsupported active or external content');

    const externalPath = await workbookFile(baseEntries('<Relationship Id="rId2" Target="https://example.invalid/data.xlsx" TargetMode="External"/>'));
    await expect(streamWorkbook(externalPath, { wantedSheets: new Set(), onRow: () => undefined }))
      .rejects.toThrow('external relationship');
  });

  it('rejects workbook XML document types', async () => {
    const entries = baseEntries();
    entries['xl/workbook.xml'] = entries['xl/workbook.xml'].replace('?>', '?><!DOCTYPE workbook [<!ENTITY x "unsafe">]>');
    const filePath = await workbookFile(entries);
    await expect(streamWorkbook(filePath, { wantedSheets: new Set(), onRow: () => undefined }))
      .rejects.toThrow('document types are not accepted');

    const delayed = baseEntries();
    delayed['xl/worksheets/sheet1.xml'] = `<?xml version="1.0"?><!--${'x'.repeat(9_000)}--><!DOCTYPE worksheet [<!ENTITY x "unsafe">]><worksheet><sheetData/></worksheet>`;
    const delayedPath = await workbookFile(delayed);
    await expect(streamWorkbook(delayedPath, { wantedSheets: new Set(['Facilities']), onRow: () => undefined }))
      .rejects.toThrow('document types are not accepted');
  });

  it('reports hidden rows and formula cells without executing formulas', async () => {
    const filePath = await workbookFile(baseEntries('', 'hidden="1"', '<f>WEBSERVICE(&quot;https://example.invalid&quot;)</f>'));
    const values: unknown[] = [];
    const result = await streamWorkbook(filePath, {
      wantedSheets: new Set(['Facilities']),
      onRow: (_sheet, row) => values.push(row.cells[0]),
    });
    expect(result).toMatchObject({ hiddenRows: 1, formulaCells: 1 });
    expect(values).toEqual(['04330']);
  });

  it('enforces compressed and expanded size limits', async () => {
    const filePath = await workbookFile(baseEntries());
    await expect(streamWorkbook(filePath, { wantedSheets: new Set(), onRow: () => undefined, maxFileBytes: 10 }))
      .rejects.toThrow('limit is 10');
    await expect(streamWorkbook(filePath, { wantedSheets: new Set(), onRow: () => undefined, maxUncompressedBytes: 20 }))
      .rejects.toThrow('safety limit');
  });

  it('rejects a renamed non-ZIP file and invalid numeric limits', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'xlsx-safety-'));
    temporaryDirectories.push(directory);
    const invalidPath = path.join(directory, 'renamed.xlsx');
    await writeFile(invalidPath, 'not an xlsx package');
    await expect(streamWorkbook(invalidPath, { wantedSheets: new Set(), onRow: () => undefined }))
      .rejects.toThrow('ZIP file signature is missing');

    const validPath = await workbookFile(baseEntries());
    await expect(streamWorkbook(validPath, {
      wantedSheets: new Set(),
      onRow: () => undefined,
      maxRowsPerSheet: Number.NaN,
    })).rejects.toThrow('maxRowsPerSheet must be an integer');
  });

  it('limits ZIP entry count and expansion ratio', async () => {
    const filePath = await workbookFile({ ...baseEntries(), 'docProps/core.xml': 'metadata' });
    await expect(streamWorkbook(filePath, {
      wantedSheets: new Set(),
      onRow: () => undefined,
      maxZipEntries: 2,
    })).rejects.toThrow('more than 2 ZIP entries');

    const compressedPath = await workbookFile({
      ...baseEntries(),
      'xl/sharedStrings.xml': `<sst><si><t>${'A'.repeat(20_000)}</t></si></sst>`,
    });
    await expect(streamWorkbook(compressedPath, {
      wantedSheets: new Set(),
      onRow: () => undefined,
      maxCompressionRatio: 2,
    })).rejects.toThrow('compression ratio limit');
  });

  it('limits worksheet width and cell length', async () => {
    const wide = baseEntries();
    wide['xl/worksheets/sheet1.xml'] = '<worksheet><sheetData><row r="1"><c r="C1" t="str"><v>x</v></c></row></sheetData></worksheet>';
    const widePath = await workbookFile(wide);
    await expect(streamWorkbook(widePath, {
      wantedSheets: new Set(['Facilities']),
      onRow: () => undefined,
      maxColumnsPerRow: 2,
    })).rejects.toThrow('column safety limit');

    const long = baseEntries();
    long['xl/worksheets/sheet1.xml'] = '<worksheet><sheetData><row r="1"><c r="A1" t="str"><v>too-long</v></c></row></sheetData></worksheet>';
    const longPath = await workbookFile(long);
    await expect(streamWorkbook(longPath, {
      wantedSheets: new Set(['Facilities']),
      onRow: () => undefined,
      maxCellCharacters: 4,
    })).rejects.toThrow('cell length limit');
  });
});
