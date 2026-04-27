const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const db = require('../db');

/**
 * Converts numbers to Indian Word Format (Rupees/Lakhs/Crores)
 */
function numberToWords(num) {
    if (num === 0) return 'Zero';
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    
    function convertChunk(n) {
        let chunk = '';
        if (n >= 100) { chunk += ones[Math.floor(n / 100)] + ' Hundred '; n %= 100; }
        if (n > 0) {
            if (n < 20) chunk += ones[n] + ' ';
            else { chunk += tens[Math.floor(n / 10)] + ' '; if (n % 10 > 0) chunk += ones[n % 10] + ' '; }
        }
        return chunk;
    }

    let integerPart = Math.floor(num);
    let word = '';
    
    if (integerPart >= 10000000) { word += convertChunk(Math.floor(integerPart / 10000000)) + 'Crore '; integerPart %= 10000000; }
    if (integerPart >= 100000) { word += convertChunk(Math.floor(integerPart / 100000)) + 'Lakh '; integerPart %= 100000; }
    if (integerPart >= 1000) { word += convertChunk(Math.floor(integerPart / 1000)) + 'Thousand '; integerPart %= 1000; }
    word += convertChunk(integerPart);
    
    return word.trim();
}

function fmtAmount(val) {
  if (!val && val !== 0) return '—';
  return parseFloat(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function drawGradientBand(doc, x, y, width, height, text) {
  const grad = doc.linearGradient(x, y, x + width, y);
  grad.stop(0, '#1a237e').stop(1, '#0288d1'); 
  
  doc.save();
  doc.roundedRect(x, y, width, height, 4).fill(grad);
  doc.fillColor('#FFFFFF').fontSize(8.5).font('JetBrainsMono-Bold')
     .text(text, x + 15, y + 5, { lineBreak: false });
  doc.restore();
}

/**
 * Main export for PDF generation
 */
module.exports = async (invoice, res) => {
  const items = invoice.items || [];

  const doc = new PDFDocument({ 
    margin: 30, 
    size: 'A4',
    autoFirstPage: true
  }); 

  // 0. Register Fonts
  const fontPath = '/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Regular.ttf';
  const fontBoldPath = '/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Bold.ttf';
  
  if (fs.existsSync(fontPath)) {
      doc.registerFont('JetBrainsMono', fontPath);
      doc.registerFont('JetBrainsMono-Bold', fontBoldPath);
  } else {
      doc.registerFont('JetBrainsMono', 'Courier');
      doc.registerFont('JetBrainsMono-Bold', 'Courier-Bold');
  }
  
  doc.page.margins.bottom = 0;
  
  const PW = doc.page.width;
  const PH = doc.page.height;
  const ML = 35;
  const MR = 35;
  const CW = PW - ML - MR;

  doc.pipe(res);

  // 1. Brand Accents
  doc.save();
  doc.rect(0, 0, PW, 12).fill('#1a237e');
  doc.rect(0, 12, 180, 4).fill('#0288d1');
  doc.restore();

  // 2. Logo
  let currentY = 25;
  const logoPath = path.join(__dirname, '../../frontend/assets/img/logo.png');
  const logoWidth = 90;
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, PW - MR - logoWidth, currentY, { width: logoWidth });
  }

  // 3. Title
  currentY = 75;
  doc.save()
     .font('JetBrainsMono-Bold').fontSize(14).fillColor('#1a237e')
     .text('BLC TRAINER INVOICE', 0, currentY, { width: PW, align: 'center', lineBreak: false });
  doc.restore();
  currentY += 20;

  // 4. Contact Block
  doc.font('JetBrainsMono').fontSize(8).fillColor('#5c6bc0');
  const addrText = '1589, Alpha, 4th floor, Kenchanahalli Main road BEML 5th Stage Rajarajeswari Nagar, Bangalore 560098';
  let addrHeight = doc.heightOfString(addrText, { width: CW - 100, align: 'center' });
  doc.text(addrText, (PW - (CW - 100)) / 2, currentY, { width: CW - 100, align: 'center', lineBreak: true });
  currentY += addrHeight + 8;
  
  const emailLbl = 'Email: ';
  const emailVal = 'info@blcompiler.com   ';
  const phoneLbl = 'Phone: ';
  const phoneVal = '+91 70266 76672';
  
  doc.font('JetBrainsMono-Bold').fontSize(8);
  const w1 = doc.widthOfString(emailLbl);
  const w3 = doc.widthOfString(phoneLbl);
  doc.font('JetBrainsMono');
  const w2 = doc.widthOfString(emailVal);
  const w4 = doc.widthOfString(phoneVal);
  
  const totalW = w1 + w2 + w3 + w4;
  let startX = (PW - totalW) / 2;
  
  doc.font('JetBrainsMono-Bold').fillColor('#1a237e').text(emailLbl, startX, currentY, { lineBreak: false });
  startX += w1;
  doc.font('JetBrainsMono').fillColor('#0288d1').text(emailVal, startX, currentY, { lineBreak: false });
  startX += w2;
  doc.font('JetBrainsMono-Bold').fillColor('#1a237e').text(phoneLbl, startX, currentY, { lineBreak: false });
  startX += w3;
  doc.font('JetBrainsMono').fillColor('#0288d1').text(phoneVal, startX, currentY, { lineBreak: false });

  currentY += 40;

  // 5. Invoice Details
  drawGradientBand(doc, ML, currentY, CW, 16, 'INVOICE DETAILS');
  currentY += 22;
  const invDate = invoice.submitted_at ? new Date(invoice.submitted_at).toLocaleDateString('en-GB') : new Date(invoice.created_at).toLocaleDateString('en-GB');
  doc.font('JetBrainsMono-Bold').fillColor('#000000').fontSize(8);
  doc.text('Invoice Number: ', ML, currentY, {continued: true, lineBreak: false}).font('JetBrainsMono').text(invoice.invoice_no, {lineBreak: false});
  doc.font('JetBrainsMono-Bold').text('Payment Terms: ', ML + CW/2, currentY, {continued: true, lineBreak: false}).font('JetBrainsMono').text('10 Days', {lineBreak: false});
  currentY += 12;
  doc.font('JetBrainsMono-Bold').text('Invoice Date: ', ML, currentY, {continued: true, lineBreak: false}).font('JetBrainsMono').text(invDate, {lineBreak: false});
  doc.font('JetBrainsMono-Bold').text('Due Date: ', ML + CW/2, currentY, {continued: true, lineBreak: false}).font('JetBrainsMono').text(invDate, {lineBreak: false});
  currentY += 12;
  doc.font('JetBrainsMono-Bold').text('Training College: ', ML, currentY, {continued: true, lineBreak: false}).font('JetBrainsMono').text(invoice.training_college || '—', {lineBreak: false});
  currentY += 22;

  // 6. Trainer Details
  drawGradientBand(doc, ML, currentY, CW, 16, 'TRAINER DETAILS');
  currentY += 22;
  const trDetails = [
    ['Trainer Name:', invoice.trainer_name, 'Bank Name:', invoice.bank_name],
    ['Mobile Number:', invoice.trainer_phone || invoice.phone, 'Account Number:', invoice.bank_account],
    ['Email ID:', invoice.trainer_email, 'IFSC Code:', invoice.ifsc],
    ['PAN Card:', invoice.pan, 'Branch:', invoice.branch]
  ];
  trDetails.forEach(row => {
    doc.font('JetBrainsMono-Bold').text(row[0] + ' ', ML, currentY, {continued: true, lineBreak: false}).font('JetBrainsMono').text(row[1] || '—', {lineBreak: false});
    doc.font('JetBrainsMono-Bold').text(row[2] + ' ', ML + CW/2, currentY, {continued: true, lineBreak: false}).font('JetBrainsMono').text(row[3] || '—', {lineBreak: false});
    currentY += 12;
  });
  currentY += 15;

  // 7. Work Table
  drawGradientBand(doc, ML, currentY, CW, 16, 'WORK DETAILS');
  currentY += 22;

  const colX = [ML, ML + 35, ML + 300, ML + 370, ML + 450];
  const colW = [35, 265, 70, 80, 75];
  
  function drawRow(y, vals, isHeader = false) {
    doc.save();
    doc.rect(ML, y, CW, 18).stroke('#e0e0e0');
    [1, 2, 3, 4].forEach(i => doc.moveTo(colX[i], y).lineTo(colX[i], y + 18).stroke('#e0e0e0'));
    doc.font(isHeader ? 'JetBrainsMono-Bold' : 'JetBrainsMono').fontSize(8).fillColor('#000000');
    vals.forEach((v, i) => {
        doc.text(String(v || ''), colX[i] + 5, y + 5, { 
            width: colW[i] - 10, 
            align: i >= 2 ? 'center' : 'left',
            lineBreak: false 
        });
    });
    doc.restore();
  }

  drawRow(currentY, ['SL.', 'Description of Work', 'Days', 'Rate', 'Amount'], true);
  currentY += 18;

  items.forEach(it => {
    drawRow(currentY, [it.sno, it.particulars, it.hours_days, it.rate, fmtAmount(it.amount)]);
    currentY += 18;
  });

  let fillCount = Math.max(0, 3 - items.length);
  for(let i=0; i<fillCount; i++) {
    drawRow(currentY, ['', '', '', '', '']);
    currentY += 18;
  }

  // Total
  doc.save();
  doc.rect(ML, currentY, CW, 18).fill('#f8f9fe').stroke('#e0e0e0');
  doc.font('JetBrainsMono-Bold').fontSize(8).fillColor('#1a237e').text('Total Amount Payable (INR)', ML + 150, currentY + 5, {lineBreak: false});
  doc.text(fmtAmount(invoice.subtotal), colX[4] + 5, currentY + 5, { width: colW[4] - 10, align: 'center', lineBreak: false });
  doc.restore();
  currentY += 28;

  const totalVal = parseFloat(invoice.subtotal) || 0;
  const amtWords = 'Rupees ' + numberToWords(totalVal) + ' Only';
  doc.font('JetBrainsMono-Bold').fontSize(8).fillColor('#000000').text('Amount in Words: ', ML, currentY, {continued: true, lineBreak: false})
     .font('JetBrainsMono').text(amtWords, {lineBreak: false});
  currentY += 28;

  // Declaration & Signatures
  drawGradientBand(doc, ML, currentY, CW, 16, 'DECLARATION');
  currentY += 20;
  doc.font('JetBrainsMono-Bold').fontSize(7).fillColor('#5c6bc0').text('I hereby declare that the above mentioned details are true and correct to the best of my knowledge.', ML, currentY, {lineBreak: false});
  currentY += 35;

  const sigBaseY = currentY;
  
  // Trainer Signature
  doc.save();
  doc.font('JetBrainsMono-Bold').fontSize(8).fillColor('#1a237e').text('TRAINER SIGNATURE', ML, sigBaseY, {lineBreak: false});
  if (invoice.signature_path && invoice.status !== 'draft') {
    const sigImg = path.join(__dirname, '../../uploads', invoice.signature_path);
    if (fs.existsSync(sigImg)) doc.image(sigImg, ML, sigBaseY + 8, { height: 35 });
  }
  doc.font('JetBrainsMono').fillColor('#000000').text(invoice.trainer_name || '—', ML, sigBaseY + 40, {lineBreak: false});
  doc.restore();

  // Admin Signature
  if (['approved', 'processing', 'paid'].includes(invoice.status)) {
    const adminRes = db.query("SELECT name, signature_path FROM users WHERE role IN ('admin', 'superadmin') AND signature_path IS NOT NULL LIMIT 1");
    const adminQuery = adminRes[0];
    if (adminQuery && adminQuery.signature_path) {
      const aSig = path.join(__dirname, '../../uploads', adminQuery.signature_path);
      if (fs.existsSync(aSig)) {
        doc.save();
        doc.font('JetBrainsMono-Bold').fontSize(8).fillColor('#1a237e').text('AUTHORIZED SIGNATORY', ML + CW - 180, sigBaseY, { align: 'right', width: 180, lineBreak: false });
        doc.image(aSig, ML + CW - 110, sigBaseY + 10, { height: 25 });
        doc.font('JetBrainsMono-Bold').fillColor('#000000').text('Vishal Vanaki', ML + CW - 180, sigBaseY + 40, { align: 'right', width: 180, lineBreak: false });
        doc.font('JetBrainsMono').fillColor('#555555').text('Founder', ML + CW - 180, sigBaseY + 52, { align: 'right', width: 180, lineBreak: false });
        doc.restore();
      }
    }
  }

  function drawFooter(pageDoc) {
    pageDoc.save();
    const footerY = PH - 45;
    pageDoc.rect(0, footerY, PW, 25).fill('#f8f9fe');
    pageDoc.rect(0, footerY, 120, 1.5).fill('#1a237e');
    pageDoc.rect(PW - 120, footerY, 120, 1.5).fill('#0288d1');
    
    pageDoc.font('JetBrainsMono-Bold').fontSize(10).fillColor('#1a237e')
           .text('Behave Like Compiler', 0, footerY + 6, { align: 'center', width: PW, lineBreak: false });
    pageDoc.fontSize(7).font('JetBrainsMono').fillColor('#9fa8da')
           .text('Modern Invoice Platform | Proprietary & Confidential', 0, footerY + 17, { align: 'center', width: PW, lineBreak: false });
    pageDoc.restore();
  }
  
  drawFooter(doc);
  doc.end();
};
