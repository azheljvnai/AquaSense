import { describe, it, expect } from 'vitest';
import { escapeXml, rowsToStyledExcelBlob } from '../public/js/features/report-format.js';

describe('report-format', () => {
  describe('escapeXml', () => {
    it('escapes XML special characters', () => {
      expect(escapeXml('a & b < c > d " e')).toBe('a &amp; b &lt; c &gt; d &quot; e');
    });

    it('handles null and undefined', () => {
      expect(escapeXml(null)).toBe('');
      expect(escapeXml(undefined)).toBe('');
    });
  });

  describe('rowsToStyledExcelBlob', () => {
    it('returns a Blob with spreadsheet XML content', () => {
      const blob = rowsToStyledExcelBlob([
        ['--- FEEDING ---'],
        ['metric', 'value'],
        ['total_dispenses', '2'],
      ]);
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('application/vnd.ms-excel');
    });
  });
});
