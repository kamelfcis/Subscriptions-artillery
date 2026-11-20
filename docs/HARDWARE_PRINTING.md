# Hardware and printing

Date: 11 November 2026. Status: software path only. HARDWARE VERIFIED: no. PRODUCTION ACCEPTED: no.

## What is implemented

- `web/src/card-template.json` holds the CR80 layout. `duplex` is false and `backSide` is null. The card dialog shows "الوجه الخلفي غير مدعوم".
- `web/src/print-choice.js` prefers an installed XPS Card Printer and otherwise selects Microsoft Print to PDF. The dialog's initial printer is Print to PDF. Vitest covers that choice.
- The button label is "إرسال إلى طابور الطباعة". A successful agent response is accepted only when status is `SPOOLED`.
- `print-agent/Program.cs` returns HTTP 400 `DUPLEX_UNSUPPORTED` when `duplex` is true. The source change was not rebuilt. An older agent process may still be listening on port 5678. Playwright opened the card dialog and did not click send. No job was sent to Microsoft Print to PDF, the Xprinter, or the UTAX device.
- `AppCardJobs.reprint_reason` exists on staging. A second prepare for the same member requires a reason of at least 4 characters. The integration test did not insert a card job.

## Installed printers observed earlier the same day

Microsoft Print to PDF (Normal), Xprinter XP-235B (Normal), UTAX_TA 5006ci (Error). No Datacard, Entrust, or XPS Card Printer.

## Blocker

Physical CR80 output, ribbon, duplex, and Arabic on PVC remain blocked until that printer is on this machine and a spool is inspected. `SPOOLED` must not be reported as printed.
