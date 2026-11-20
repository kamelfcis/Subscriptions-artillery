import { describe, expect, it } from 'vitest';
import { choosePrinter, PDF_PRINTER } from './print-choice';
import template from './card-template.json';

describe('print defaults', () => {
  it('uses Print to PDF when XPS is missing', () => {
    expect(choosePrinter(['Microsoft Print to PDF', 'Fax'])).toBe('Microsoft Print to PDF');
    expect(choosePrinter([])).toBe(PDF_PRINTER);
  });
  it('keeps XPS when that driver is installed', () => {
    expect(choosePrinter(['Microsoft Print to PDF', 'XPS Card Printer'])).toBe('XPS Card Printer');
  });
  it('ships front-only overlay template for pre-printed stock', () => {
    expect(template.duplex).toBe(false);
    expect(template.overlay).toBe(true);
    expect(template.backSide?.enabled).toBe(false);
    expect(template.rank?.label).toMatch(/الرتب/);
    expect(template.name?.label).toMatch(/الا?\s*س/);
    expect(template.expiry?.label).toMatch(/ينتهى/);
    expect(template.signature?.lines?.length).toBeGreaterThanOrEqual(2);
    expect(template.logo?.show).toBe(false);
    expect(template.qr?.show).toBe(false);
  });
});
