export const PDF_PRINTER='Microsoft Print to PDF';
export function choosePrinter(list=[]){const names=list.filter(Boolean);const xps=names.find(p=>p==='XPS Card Printer');if(xps)return xps;const pdf=names.find(p=>/print to pdf/i.test(p));if(pdf)return pdf;return names[0]||PDF_PRINTER;}
