import { describe, expect, it } from 'vitest';
import { safeFileName, sniffContentType } from './employee-documents.service.js';
import { contentDisposition } from './employees.controller.js';

describe('sniffContentType', () => {
  it('recognises allowed types by magic bytes, not by name', () => {
    expect(sniffContentType(Buffer.from('%PDF-1.4 ...'))).toBe('application/pdf');
    expect(sniffContentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      'image/png',
    );
    expect(sniffContentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffContentType(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'))).toBe(
      'image/webp',
    );
  });

  it('rejects everything else', () => {
    expect(sniffContentType(Buffer.from('MZ\x90\x00', 'latin1'))).toBeNull();
    expect(sniffContentType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffContentType(Buffer.alloc(0))).toBeNull();
  });
});

describe('file names', () => {
  it('strips paths and unsafe characters', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\Users\\x\\offer "letter".pdf')).toBe('offer _letter_.pdf');
    expect(safeFileName('a\u0000b.pdf')).toBe('a_b.pdf');
    expect(safeFileName('')).toBe('file');
  });

  it('builds an RFC 6266 attachment header with a UTF-8 name', () => {
    expect(contentDisposition('Résumé.pdf')).toBe(
      `attachment; filename="R_sum_.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9.pdf`,
    );
  });
});
