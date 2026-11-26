import { Injectable } from '@nestjs/common';
import type { InvoiceDetails, PayslipItem } from '@hrm/shared-types';
import { PdfService } from './pdf.service.js';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');

/**
 * System PDFs rendered from stored, finalized figures (ADR-018): payslips of finalized runs and
 * issued invoices. No figure is computed here.
 */
@Injectable()
export class StatementsService {
  constructor(private readonly pdf: PdfService) {}

  payslip(p: PayslipItem): Promise<Uint8Array> {
    const earnings = p.lines.filter((l) => l.category === 'EARNING');
    const deductions = p.lines.filter((l) => l.category !== 'EARNING');
    const row = (l: PayslipItem['lines'][number], kind: string) => [
      kind,
      `${l.name}${l.forMonth && l.forYear ? ` (arrears ${MONTHS[l.forMonth - 1] ?? ''} ${String(l.forYear)})` : ''}`,
      l.amount,
    ];
    return this.pdf.statement({
      organizationName: p.company.legalName ?? p.company.name,
      title: `Payslip — ${MONTHS[p.month - 1] ?? ''} ${String(p.year)}`,
      facts: [
        ['Employee', `${p.employee.displayName} (${p.employee.employeeNumber})`],
        [
          'Payable days',
          `${p.payableDays} of ${p.periodDays}${p.lossOfPayDays !== '0' && p.lossOfPayDays !== '0.00' ? ` (loss of pay ${p.lossOfPayDays})` : ''}`,
        ],
        ...(p.taxRegime ? ([['Tax regime', label(p.taxRegime)]] as [string, string][]) : []),
        ...(p.bankAccount
          ? ([['Paid to', `${p.bankAccount.bankName} ••${p.bankAccount.last4}`]] as [
              string,
              string,
            ][])
          : []),
      ],
      columns: [
        { label: 'Type', width: 90 },
        { label: 'Component', width: 280 },
        { label: 'Amount', width: 100, right: true },
      ],
      rows: [
        ...earnings.map((l) => row(l, 'Earning')),
        ...deductions.map((l) => row(l, label(l.category))),
      ],
      totals: [
        ['Gross earnings', p.gross],
        ['Total deductions', p.totalDeductions],
        ['Net pay', p.netPay],
      ],
      notes: p.annualTaxProjection ? `Projected annual income tax: ${p.annualTaxProjection}` : null,
      footer: `Finalized ${p.finalizedAt.slice(0, 10)} · system-generated from the finalized payroll run`,
    });
  }

  invoice(inv: InvoiceDetails, organizationName: string): Promise<Uint8Array> {
    return this.pdf.statement({
      organizationName,
      title: `Invoice ${inv.number ?? '(draft)'}`,
      facts: [
        ['Bill to', inv.client.name],
        ['Issued', inv.issuedOn ?? '—'],
        ['Due', inv.dueOn ?? '—'],
        ['Currency', inv.currency],
        ...(inv.status === 'VOID'
          ? ([['Status', `VOID — ${inv.voidReason ?? ''}`]] as [string, string][])
          : []),
      ],
      columns: [
        { label: 'Description', width: 215 },
        { label: 'Qty', width: 45, right: true },
        { label: 'Unit price', width: 70, right: true },
        { label: 'Tax', width: 60, right: true },
        { label: 'Total', width: 70, right: true },
      ],
      rows: inv.lines.map((l) => [
        l.description,
        l.quantity,
        l.unitPrice,
        l.taxName ? l.tax : '—',
        l.total,
      ]),
      totals: [
        ['Subtotal', inv.subtotal],
        ['Tax', inv.taxTotal],
        [`Total (${inv.currency})`, inv.total],
        ['Paid', inv.paid],
        ['Balance due', inv.balance],
      ],
      notes:
        [
          inv.notes,
          ...inv.lines
            .filter((l) => l.taxName)
            .map((l) => `${l.description}: ${l.taxName ?? ''} ${l.taxPercent ?? ''}%`),
        ]
          .filter(Boolean)
          .join('\n') || null,
      footer: `${inv.number ?? 'Draft'} · system-generated`,
    });
  }
}
