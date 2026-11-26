import { Injectable } from '@nestjs/common';
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib';

/**
 * PDF rendering with pdf-lib and the built-in Helvetica (ADR-018). Helvetica covers Latin
 * script (WinAnsi); other characters are replaced with "?" and amounts carry a currency code
 * instead of a symbol. Layouts only — every figure comes from stored data.
 */

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.44, 0.48);

/** Characters Helvetica/WinAnsi can draw beyond Latin-1. */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

export function winAnsi(text: string): string {
  let out = '';
  for (const ch of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ')) {
    const code = ch.codePointAt(0) ?? 63;
    out +=
      ch === '\n' ||
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xff) ||
      WIN_ANSI_EXTRA.has(ch)
        ? ch
        : '?';
  }
  return out;
}

class Writer {
  page!: PDFPage;
  y = 0;
  pages = 0;

  constructor(
    readonly doc: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
    readonly header: string,
  ) {
    this.newPage();
  }

  newPage(): void {
    this.page = this.doc.addPage(A4);
    this.pages++;
    this.y = A4[1] - MARGIN;
    this.page.drawText(winAnsi(this.header), {
      x: MARGIN,
      y: this.y,
      size: 9,
      font: this.bold,
      color: MUTED,
    });
    this.y -= 28;
  }

  ensure(h: number): void {
    if (this.y - h < MARGIN + 24) this.newPage();
  }

  /** Wraps text to the width; returns the lines. */
  wrap(text: string, size: number, width: number, font = this.font): string[] {
    const lines: string[] = [];
    for (const para of winAnsi(text).split('\n')) {
      if (!para.trim()) {
        lines.push('');
        continue;
      }
      let line = '';
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= width) line = next;
        else {
          if (line) lines.push(line);
          // A single word longer than the line is broken by characters.
          let w = word;
          while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
            let cut = w.length - 1;
            while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
            lines.push(w.slice(0, cut));
            w = w.slice(cut);
          }
          line = w;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  text(
    text: string,
    opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {},
  ): void {
    const size = opts.size ?? 11;
    const font = opts.bold ? this.bold : this.font;
    for (const line of this.wrap(text, size, A4[0] - 2 * MARGIN, font)) {
      this.ensure(size * 1.45);
      if (line)
        this.page.drawText(line, { x: MARGIN, y: this.y, size, font, color: opts.color ?? INK });
      this.y -= size * 1.45;
    }
    this.y -= opts.gap ?? 4;
  }

  /** A row of cells at fixed x positions (right-aligned when `right`). */
  row(
    cells: { text: string; x: number; width: number; right?: boolean; bold?: boolean }[],
    size = 10,
  ): void {
    const lines = cells.map((c) =>
      this.wrap(c.text, size, c.width, c.bold ? this.bold : this.font),
    );
    const h = Math.max(...lines.map((l) => l.length)) * size * 1.4 + 4;
    this.ensure(h);
    cells.forEach((c, i) => {
      const font = c.bold ? this.bold : this.font;
      (lines[i] ?? []).forEach((line, j) => {
        const w = font.widthOfTextAtSize(line, size);
        this.page.drawText(line, {
          x: c.right ? c.x + c.width - w : c.x,
          y: this.y - j * size * 1.4,
          size,
          font,
          color: INK,
        });
      });
    });
    this.y -= h;
  }

  rule(): void {
    this.ensure(8);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y + 4 },
      end: { x: A4[0] - MARGIN, y: this.y + 4 },
      thickness: 0.5,
      color: MUTED,
    });
    this.y -= 8;
  }

  /** Stamps a footer with page numbers on the pages from `from` on (earlier pages keep theirs). */
  footer(note: string, from = 0): void {
    const pages = this.doc.getPages().slice(from);
    pages.forEach((p, i) => {
      const label = winAnsi(`${note}  ·  Page ${String(i + 1)} of ${String(pages.length)}`);
      p.drawText(label, { x: MARGIN, y: MARGIN - 20, size: 8, font: this.font, color: MUTED });
    });
  }
}

export interface StatementInput {
  organizationName: string;
  title: string;
  /** Key facts shown under the title (e.g. employee, period). */
  facts: [string, string][];
  columns: { label: string; width: number; right?: boolean }[];
  rows: string[][];
  totals: [string, string][];
  notes?: string | null;
  footer: string;
}

@Injectable()
export class PdfService {
  private async start(header: string): Promise<Writer> {
    const doc = await PDFDocument.create();
    doc.setProducer('HRM Enterprise');
    doc.setCreator('HRM Enterprise');
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    return new Writer(doc, font, bold, header);
  }

  /** A letter from a template: title and body text. */
  async letter(input: {
    organizationName: string;
    title: string;
    body: string;
    footer: string;
  }): Promise<Uint8Array> {
    const w = await this.start(input.organizationName);
    w.doc.setTitle(winAnsi(input.title));
    w.text(input.title, { size: 16, bold: true, gap: 12 });
    w.text(input.body);
    w.footer(input.footer);
    return w.doc.save();
  }

  /** A statement with facts, a table and totals (payslips, invoices). */
  async statement(input: StatementInput): Promise<Uint8Array> {
    const w = await this.start(input.organizationName);
    w.doc.setTitle(winAnsi(input.title));
    w.text(input.title, { size: 16, bold: true, gap: 10 });
    for (const [k, v] of input.facts)
      w.row([
        { text: k, x: MARGIN, width: 150, bold: true },
        { text: v, x: MARGIN + 160, width: 320 },
      ]);
    w.y -= 8;
    let x = MARGIN;
    const cols = input.columns.map((c) => {
      const col = { ...c, x };
      x += c.width + 8;
      return col;
    });
    w.row(
      cols.map((c) => ({
        text: c.label,
        x: c.x,
        width: c.width,
        ...(c.right ? { right: true } : {}),
        bold: true,
      })),
    );
    w.rule();
    for (const r of input.rows)
      w.row(
        cols.map((c, i) => ({
          text: r[i] ?? '',
          x: c.x,
          width: c.width,
          ...(c.right ? { right: true } : {}),
        })),
      );
    w.rule();
    const last = cols.at(-1);
    for (const [k, v] of input.totals)
      w.row([
        { text: k, x: MARGIN, width: (last?.x ?? MARGIN) - MARGIN - 8, right: true, bold: true },
        { text: v, x: last?.x ?? MARGIN, width: last?.width ?? 80, right: true, bold: true },
      ]);
    if (input.notes) {
      w.y -= 10;
      w.text(input.notes, { size: 9, color: MUTED });
    }
    w.footer(input.footer);
    return w.doc.save();
  }

  /** Appends an acceptance certificate page to an existing PDF. */
  async withCertificate(
    original: Uint8Array,
    input: {
      organizationName: string;
      documentTitle: string;
      sha256: string;
      records: { name: string; method: string; at: string; ip: string | null; hash: string }[];
    },
  ): Promise<Uint8Array> {
    const doc = await PDFDocument.load(original);
    const existing = doc.getPageCount();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const w = new Writer(doc, font, bold, input.organizationName);
    w.text('Acceptance certificate', { size: 16, bold: true, gap: 10 });
    w.text(`Document: ${input.documentTitle}`);
    w.text(`SHA-256 of the accepted document: ${input.sha256}`, { size: 9 });
    w.text(
      'Each person below accepted this exact document (same SHA-256) electronically in HRM Enterprise. This records consent within the system; it is not a qualified or Aadhaar-based electronic signature.',
      { size: 9, color: MUTED, gap: 10 },
    );
    for (const r of input.records) {
      w.rule();
      w.text(r.name, { bold: true, gap: 0 });
      w.text(
        `Accepted ${r.at} by ${r.method === 'EMAIL_OTP' ? 'e-mailed one-time code' : 'signed-in account'}${r.ip ? ` from ${r.ip}` : ''}`,
        { size: 9, gap: 0 },
      );
      w.text(`Hash at acceptance: ${r.hash}`, { size: 8, color: MUTED });
    }
    w.footer('Acceptance certificate', existing);
    return doc.save();
  }
}
