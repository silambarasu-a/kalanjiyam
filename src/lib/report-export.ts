"use client";

import ExcelJS from "exceljs";

/**
 * Reusable client-side exporters for report tables. Three formats:
 *
 *   - CSV  — zero-dep, RFC 4180 quoting, Excel-friendly UTF-8 BOM.
 *   - XLSX — exceljs, with header styling + auto-fit width + frozen header.
 *   - PDF  — uses the browser's print dialog (Save as PDF). The page is
 *     responsible for hiding chrome via the .print-container / .no-print
 *     classes from the print stylesheet.
 *
 * Column shape: `{ key, label, type? }` where `type` controls export
 * formatting in Excel only (date / number / currency). CSV always renders
 * the raw value via String(); UI is responsible for display formatting.
 */

export type ExportColumn<T> = {
  key: keyof T & string;
  label: string;
  type?: "string" | "number" | "currency" | "date";
};

export type ExportPayload<T> = {
  filename: string; // without extension
  sheetName?: string;
  title?: string;
  subtitle?: string;
  columns: ExportColumn<T>[];
  rows: T[];
  // Optional aggregates rendered as a "Totals" row at the bottom of XLSX.
  totals?: Partial<Record<keyof T & string, number | string>>;
};

// ── CSV ──────────────────────────────────────────────────────────────────

export function downloadCSV<T extends Record<string, unknown>>(
  payload: ExportPayload<T>,
): void {
  const rows: string[] = [];
  rows.push(payload.columns.map((c) => csvCell(c.label)).join(","));
  for (const r of payload.rows) {
    rows.push(
      payload.columns
        .map((c) => csvCell(formatCSVValue(r[c.key])))
        .join(","),
    );
  }
  if (payload.totals) {
    rows.push(
      payload.columns
        .map((c) => csvCell(formatCSVValue(payload.totals?.[c.key] ?? "")))
        .join(","),
    );
  }
  // Prepend BOM so Excel opens UTF-8 cleanly on Windows.
  const blob = new Blob(["﻿" + rows.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  triggerDownload(blob, `${payload.filename}.csv`);
}

function csvCell(v: string): string {
  if (v == null) return "";
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function formatCSVValue(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") return String(v);
  return String(v);
}

// ── XLSX ─────────────────────────────────────────────────────────────────

export async function downloadExcel<T extends Record<string, unknown>>(
  payload: ExportPayload<T>,
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kalanjiyam";
  wb.created = new Date();

  const ws = wb.addWorksheet(payload.sheetName ?? "Report", {
    views: [{ state: "frozen", ySplit: payload.title ? 3 : 1 }],
  });

  let row = 1;
  if (payload.title) {
    ws.mergeCells(row, 1, row, payload.columns.length);
    const cell = ws.getCell(row, 1);
    cell.value = payload.title;
    cell.font = { bold: true, size: 14 };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    row++;
    if (payload.subtitle) {
      ws.mergeCells(row, 1, row, payload.columns.length);
      const c = ws.getCell(row, 1);
      c.value = payload.subtitle;
      c.font = { italic: true, size: 10, color: { argb: "FF666666" } };
      row++;
    }
  }

  // Header
  const headerRow = ws.getRow(row);
  headerRow.values = payload.columns.map((c) => c.label);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF047857" },
    };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = {
      top: { style: "thin", color: { argb: "FFCCCCCC" } },
      bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
    };
  });
  row++;

  // Data rows
  for (const r of payload.rows) {
    const rr = ws.getRow(row);
    rr.values = payload.columns.map(
      (c) => excelValue(r[c.key], c.type) as ExcelJS.CellValue,
    );
    payload.columns.forEach((c, i) => {
      const cell = rr.getCell(i + 1);
      applyExcelFormat(cell, c.type);
    });
    row++;
  }

  // Totals row
  if (payload.totals) {
    const tr = ws.getRow(row);
    tr.values = payload.columns.map(
      (c) => excelValue(payload.totals?.[c.key] ?? "", c.type) as ExcelJS.CellValue,
    );
    tr.eachCell((cell, colNumber) => {
      const col = payload.columns[colNumber - 1];
      cell.font = { bold: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF3F4F6" },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "FFCCCCCC" } },
      };
      applyExcelFormat(cell, col.type);
    });
    row++;
  }

  // Auto-fit widths (reasonable approximation)
  payload.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    let max = c.label.length;
    for (const r of payload.rows) {
      const v = r[c.key];
      const len = v == null ? 0 : String(v).length;
      if (len > max) max = len;
    }
    col.width = Math.min(48, Math.max(10, max + 2));
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, `${payload.filename}.xlsx`);
}

function excelValue(v: unknown, type?: ExportColumn<unknown>["type"]): unknown {
  if (v == null || v === "") return null;
  if (type === "date") {
    if (v instanceof Date) return v;
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? v : d;
  }
  if (type === "number" || type === "currency") {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return v;
}

function applyExcelFormat(
  cell: ExcelJS.Cell,
  type?: ExportColumn<unknown>["type"],
): void {
  switch (type) {
    case "currency":
      cell.numFmt = '"₹"#,##0.00;[Red]"-₹"#,##0.00';
      cell.alignment = { horizontal: "right" };
      break;
    case "number":
      cell.numFmt = "#,##0.##";
      cell.alignment = { horizontal: "right" };
      break;
    case "date":
      cell.numFmt = "yyyy-mm-dd";
      cell.alignment = { horizontal: "left" };
      break;
  }
}

// ── PDF (browser print) ──────────────────────────────────────────────────

export function printReport(): void {
  if (typeof window !== "undefined") window.print();
}

// ── Shared download primitive ────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
