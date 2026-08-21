import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Unzip, UnzipInflate } from 'fflate';
import { SaxesParser } from 'saxes';
import type { ScalarCell } from './types';

type WorkbookSheet = { name: string; relationshipId: string; entryName: string; hidden: boolean };
type WorksheetRow = { rowNumber: number; cells: ScalarCell[]; hidden: boolean; formulaCellIndexes: number[] };

export type WorkbookSheetDetail = {
  name: string;
  hidden: boolean;
  rowsVisited: number;
  hiddenRows: number;
  formulaCells: number;
};

export type WorkbookStreamOptions = {
  wantedSheets: ReadonlySet<string>;
  onRow: (sheetName: string, row: WorksheetRow, context: { dateSystem: '1900' | '1904' }) => void;
  maxFileBytes?: number;
  maxUncompressedBytes?: number;
  maxRowsPerSheet?: number;
};

export type WorkbookStreamResult = {
  sizeBytes: number;
  sheetsSeen: string[];
  dateSystem: '1900' | '1904';
  sheetDetails: WorkbookSheetDetail[];
  formulaCells: number;
  hiddenRows: number;
};

const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_ROWS_PER_SHEET = 100_000;

function shouldCollectEntry(name: string) {
  return (
    name === 'xl/workbook.xml' ||
    name === 'xl/_rels/workbook.xml.rels' ||
    name === 'xl/sharedStrings.xml' ||
    /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)
  );
}

async function collectZipEntries(filePath: string, maxUncompressedBytes: number) {
  const collected = new Map<string, Uint8Array>();
  let declaredBytes = 0;
  let expandedBytes = 0;
  let failure: Error | null = null;
  const forbiddenEntries: string[] = [];

  const unzip = new Unzip((file) => {
    const normalizedName = file.name.replace(/\\/g, '/');
    if (normalizedName.startsWith('/') || normalizedName.split('/').includes('..')) {
      failure = new Error(`Unsafe ZIP entry path: ${file.name}`);
    }
    if (file.compression !== 0 && file.compression !== 8) {
      failure = new Error(`Unsupported or encrypted ZIP entry: ${file.name}`);
    }
    if (
      /(^|\/)(vbaProject\.bin|externalLinks|embeddings|activeX|customUI)(\/|$)/i.test(normalizedName)
      || /\.(exe|dll|com|bat|cmd|js|vbs|ps1)$/i.test(normalizedName)
    ) forbiddenEntries.push(normalizedName);
    declaredBytes += file.originalSize ?? 0;
    if (declaredBytes > maxUncompressedBytes) {
      failure = new Error(`Workbook expands beyond the ${maxUncompressedBytes}-byte safety limit.`);
    }

    const keep = shouldCollectEntry(normalizedName);
    const chunks: Uint8Array[] = [];
    let entryBytes = 0;
    file.ondata = (error, data, final) => {
      if (error) {
        failure = new Error(`Unable to expand workbook entry ${normalizedName}: ${error.message}`);
        return;
      }
      entryBytes += data.byteLength;
      expandedBytes += data.byteLength;
      if (expandedBytes > maxUncompressedBytes || entryBytes > maxUncompressedBytes) {
        failure = new Error(`Workbook expands beyond the ${maxUncompressedBytes}-byte safety limit.`);
        file.terminate();
        return;
      }
      if (keep && data.byteLength) chunks.push(data.slice());
      if (keep && final) {
        collected.set(
          normalizedName,
          new Uint8Array(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))),
        );
      }
    };
    if (!failure) file.start();
  });
  unzip.register(UnzipInflate);

  try {
    for await (const chunk of createReadStream(filePath)) {
      if (failure) throw failure;
      unzip.push(new Uint8Array(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)), false);
    }
    if (failure) throw failure;
    unzip.push(new Uint8Array(), true);
    if (failure) throw failure;
  } catch (error) {
    if (failure) throw failure;
    throw new Error(
      `Invalid, encrypted, or unsupported XLSX ZIP container: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (forbiddenEntries.length) {
    throw new Error(`Workbook contains unsupported active or external content: ${forbiddenEntries.slice(0, 3).join(', ')}.`);
  }
  return collected;
}

function readEntryText(entry: Uint8Array, entryName: string, maxBytes = 8 * 1024 * 1024) {
  if (entry.byteLength > maxBytes) {
    throw new Error(`Workbook metadata entry ${entryName} exceeds the ${maxBytes}-byte safety limit.`);
  }
  const text = Buffer.from(entry).toString('utf8');
  if (text.slice(0, 8192).toUpperCase().includes('<!DOCTYPE')) {
    throw new Error('Workbook XML document types are not accepted.');
  }
  return text;
}

function feedXml(parser: SaxesParser<{ xmlns: false; fileName: string }>, bytes: Uint8Array) {
  const prefix = Buffer.from(bytes.subarray(0, Math.min(bytes.byteLength, 8192))).toString('utf8').toUpperCase();
  if (prefix.includes('<!DOCTYPE')) throw new Error('Workbook XML document types are not accepted.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const chunkSize = 64 * 1024;
  for (let index = 0; index < bytes.byteLength; index += chunkSize) {
    parser.write(decoder.decode(bytes.subarray(index, index + chunkSize), { stream: true }));
  }
  parser.write(decoder.decode()).close();
}

function attribute(tag: { attributes: Record<string, unknown> }, name: string): string {
  const value = tag.attributes[name];
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'value' in value) return String(value.value);
  return '';
}

function parseWorkbookMetadata(xml: string) {
  const sheets: Array<Omit<WorkbookSheet, 'entryName'>> = [];
  let dateSystem: '1900' | '1904' = '1900';
  const parser = new SaxesParser({ xmlns: false, fileName: 'xl/workbook.xml' });
  parser.on('opentag', (tag) => {
    if (tag.name === 'workbookPr' && attribute(tag, 'date1904') === '1') dateSystem = '1904';
    if (tag.name === 'sheet') {
      sheets.push({
        name: attribute(tag, 'name'),
        relationshipId: attribute(tag, 'r:id'),
        hidden: ['hidden', 'veryHidden'].includes(attribute(tag, 'state')),
      });
    }
  });
  parser.write(xml).close();
  return { sheets, dateSystem };
}

function parseWorkbookRelationships(xml: string) {
  const relationships = new Map<string, string>();
  const parser = new SaxesParser({ xmlns: false, fileName: 'xl/_rels/workbook.xml.rels' });
  parser.on('opentag', (tag) => {
    if (tag.name !== 'Relationship') return;
    const id = attribute(tag, 'Id');
    const target = attribute(tag, 'Target');
    const targetMode = attribute(tag, 'TargetMode');
    if (!id || !target) return;
    if (targetMode.toLowerCase() === 'external' || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
      throw new Error('Workbook contains an external relationship.');
    }
    const entryName = target.startsWith('/')
      ? target.slice(1)
      : path.posix.normalize(path.posix.join('xl', target));
    if (!entryName.startsWith('xl/') || entryName.split('/').includes('..')) {
      throw new Error('Workbook relationship points outside the XLSX package.');
    }
    relationships.set(id, entryName);
  });
  parser.write(xml).close();
  return relationships;
}

function parseSharedStrings(entry: Uint8Array | undefined) {
  if (!entry) return [] as string[];
  const sharedStrings: string[] = [];
  const parser = new SaxesParser({ xmlns: false, fileName: 'xl/sharedStrings.xml' });
  let inItem = false;
  let inText = false;
  let current = '';

  parser.on('opentag', (tag) => {
    if (tag.name === 'si') {
      inItem = true;
      current = '';
    } else if (inItem && tag.name === 't') {
      inText = true;
    }
  });
  parser.on('text', (text) => {
    if (inItem && inText) current += text;
  });
  parser.on('cdata', (text) => {
    if (inItem && inText) current += text;
  });
  parser.on('closetag', (tag) => {
    if (tag.name === 't') inText = false;
    if (tag.name === 'si') {
      sharedStrings.push(current);
      current = '';
      inItem = false;
    }
  });

  feedXml(parser, entry);
  return sharedStrings;
}

function columnIndexFromReference(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? '';
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, index - 1);
}

function convertCellValue(type: string, raw: string, sharedStrings: string[]): ScalarCell {
  if (!raw) return null;
  if (type === 's') return sharedStrings[Number(raw)] ?? null;
  if (type === 'b') return raw === '1';
  if (type === 'inlineStr' || type === 'str') return raw;
  if (type === 'e') return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : raw;
}

function parseWorksheet(
  entry: Uint8Array,
  sharedStrings: string[],
  sheetName: string,
  maxRows: number,
  onRow: (row: WorksheetRow) => void,
): Omit<WorkbookSheetDetail, 'name' | 'hidden'> {
  const parser = new SaxesParser({ xmlns: false, fileName: sheetName });
  let rowNumber = 0;
  let rowCount = 0;
  let cells: ScalarCell[] | null = null;
  let currentCellIndex = 0;
  let currentCellType = '';
  let currentValue = '';
  let captureValue = false;
  let rowHidden = false;
  let currentCellHasFormula = false;
  let formulaCellIndexes: number[] = [];
  let hiddenRows = 0;
  let formulaCells = 0;

  parser.on('opentag', (tag) => {
    if (tag.name === 'row') {
      rowNumber = Number(attribute(tag, 'r')) || rowCount + 1;
      cells = [];
      rowHidden = attribute(tag, 'hidden') === '1' || attribute(tag, 'hidden').toLowerCase() === 'true';
      formulaCellIndexes = [];
    } else if (tag.name === 'c' && cells) {
      const reference = attribute(tag, 'r');
      currentCellIndex = reference ? columnIndexFromReference(reference) : cells.length;
      currentCellType = attribute(tag, 't');
      currentValue = '';
      currentCellHasFormula = false;
    } else if (tag.name === 'f' && cells) {
      currentCellHasFormula = true;
    } else if (cells && (tag.name === 'v' || tag.name === 't')) {
      captureValue = true;
    }
  });
  parser.on('text', (text) => {
    if (captureValue) currentValue += text;
  });
  parser.on('cdata', (text) => {
    if (captureValue) currentValue += text;
  });
  parser.on('closetag', (tag) => {
    if (tag.name === 'v' || tag.name === 't') captureValue = false;
    if (tag.name === 'c' && cells) {
      cells[currentCellIndex] = convertCellValue(currentCellType, currentValue, sharedStrings);
      if (currentCellHasFormula) {
        formulaCells += 1;
        formulaCellIndexes.push(currentCellIndex);
      }
      currentValue = '';
    }
    if (tag.name === 'row' && cells) {
      rowCount += 1;
      if (rowHidden) hiddenRows += 1;
      if (rowCount > maxRows) throw new Error(`${sheetName} exceeds the ${maxRows}-row safety limit.`);
      onRow({ rowNumber, cells, hidden: rowHidden, formulaCellIndexes });
      cells = null;
    }
  });

  feedXml(parser, entry);
  return { rowsVisited: rowCount, hiddenRows, formulaCells };
}

export async function streamWorkbook(
  filePath: string,
  options: WorkbookStreamOptions,
): Promise<WorkbookStreamResult> {
  const extension = path.extname(filePath).toLowerCase();
  if (extension !== '.xlsx') {
    throw new Error(`Unsupported workbook type: ${extension || '[none]'}. Only macro-free .xlsx files are accepted.`);
  }

  const safeName = path.basename(filePath);
  if (!safeName || safeName.length > 180 || /[\u0000-\u001f<>:"|?*]/.test(safeName)) {
    throw new Error('Workbook filename is invalid.');
  }

  const file = await stat(filePath);
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  if (file.size > maxFileBytes) {
    throw new Error(`Workbook ${path.basename(filePath)} is ${file.size} bytes; limit is ${maxFileBytes}.`);
  }

  const entries = await collectZipEntries(
    filePath,
    options.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES,
  );
    const workbookEntry = entries.get('xl/workbook.xml');
    const relationshipsEntry = entries.get('xl/_rels/workbook.xml.rels');
    if (!workbookEntry || !relationshipsEntry) throw new Error('Invalid XLSX: workbook metadata is missing.');

    const workbookXml = readEntryText(workbookEntry, 'xl/workbook.xml');
    const relationshipsXml = readEntryText(relationshipsEntry, 'xl/_rels/workbook.xml.rels');
    const metadata = parseWorkbookMetadata(workbookXml);
    const relationships = parseWorkbookRelationships(relationshipsXml);
    const sheets: WorkbookSheet[] = metadata.sheets.map((sheet) => ({
      ...sheet,
      entryName: relationships.get(sheet.relationshipId) ?? '',
    }));

    const sharedStrings = parseSharedStrings(entries.get('xl/sharedStrings.xml'));
    const sheetDetails: WorkbookSheetDetail[] = sheets.map((sheet) => ({
      name: sheet.name,
      hidden: sheet.hidden,
      rowsVisited: 0,
      hiddenRows: 0,
      formulaCells: 0,
    }));
    for (const sheet of sheets) {
      if (!options.wantedSheets.has(sheet.name)) continue;
      const entry = entries.get(sheet.entryName);
      if (!entry) throw new Error(`Invalid XLSX: worksheet XML is missing for ${sheet.name}.`);
      const detail = parseWorksheet(
        entry,
        sharedStrings,
        sheet.name,
        options.maxRowsPerSheet ?? DEFAULT_MAX_ROWS_PER_SHEET,
        (row) => options.onRow(sheet.name, row, { dateSystem: metadata.dateSystem }),
      );
      const stored = sheetDetails.find((candidate) => candidate.name === sheet.name)!;
      Object.assign(stored, detail);
    }

    return {
      sizeBytes: file.size,
      sheetsSeen: sheets.map((sheet) => sheet.name),
      dateSystem: metadata.dateSystem,
      sheetDetails,
      formulaCells: sheetDetails.reduce((sum, sheet) => sum + sheet.formulaCells, 0),
      hiddenRows: sheetDetails.reduce((sum, sheet) => sum + sheet.hiddenRows, 0),
    };
}
