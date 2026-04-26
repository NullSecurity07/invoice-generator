const nodemailer = require('nodemailer');

function createTransporter() {
  const port = Number(process.env.SMTP_PORT) || 465;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtpout.secureserver.net',
    port,
    secure: port === 465, // SSL for port 465, STARTTLS for 587
    authMethod: 'LOGIN',  // GoDaddy requires LOGIN, not PLAIN
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    tls: {
      rejectUnauthorized: false // allow GoDaddy's self-signed intermediate certs
    }
  });
}

const FROM_EMAIL = process.env.FROM_EMAIL || 'no-reply@blcompiler.com';
const ADMIN_ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL || 'blcompilers@gmail.com';

async function sendMail(to, subject, html) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log(`[STUB EMAIL to ${to}]: ${subject}`);
    return;
  }
  try {
    const transporter = createTransporter();
    await transporter.sendMail({ from: FROM_EMAIL, to, subject, html });
    console.log(`Email sent to ${to}: ${subject}`);
  } catch(e) {
    console.error('Email failed:', e.message);
  }
}

async function sendInvoiceStatusUpdate(trainerEmail, trainerName, invoiceNo, status) {
  const statusLabels = {
    under_review: 'Under Review',
    approved: 'Approved',
    processing: 'Payment Processing',
    paid: 'Paid',
    rejected: 'Rejected'
  };
  const label = statusLabels[status] || status.toUpperCase();
  const subject = `BLC Invoice Update: ${invoiceNo} is now ${label}`;
  const html = `<p>Hi ${trainerName},</p>
    <p>Your invoice <strong>${invoiceNo}</strong> status has been updated to <strong>${label}</strong>.</p>
    <p>Log in to the BLC Portal to view details or download any updated documents.</p>
    <p>Regards,<br/>BLC Finance Team</p>`;
  await sendMail(trainerEmail, subject, html);
}

async function sendNewInvoiceAlert(adminEmail, invoiceNo, trainerName, total) {
  const subject = `New Invoice Submitted: ${invoiceNo} by ${trainerName}`;
  const html = `<p>Hello Admin,</p>
    <p>A new invoice <strong>${invoiceNo}</strong> has been submitted by <strong>${trainerName}</strong> for an amount of ₹${Number(total).toLocaleString('en-IN')}.</p>
    <p>Please log in to the BLC Admin Portal to review and approve.</p>
    <p>Regards,<br/>BLC Portal System</p>`;
  await sendMail(adminEmail, subject, html);
}

// Sends an alert to blcompilers@gmail.com for any trainer invoice action
async function sendInvoiceActionAlert(invoiceNo, trainerName, action, total) {
  const actionLabels = {
    created: 'New Invoice Created (Draft)',
    submitted: 'Invoice Submitted for Review',
    updated: 'Invoice Updated by Trainer'
  };
  const subject = `[BLC] ${actionLabels[action] || action}: ${invoiceNo} — ${trainerName}`;
  const amountLine = total !== undefined
    ? `<p><strong>Amount:</strong> ₹${Number(total).toLocaleString('en-IN')}</p>`
    : '';
  const html = `<p>Hello,</p>
    <p>Invoice <strong>${invoiceNo}</strong> has been <strong>${(actionLabels[action] || action).toLowerCase()}</strong> by trainer <strong>${trainerName}</strong>.</p>
    ${amountLine}
    <p>Please log in to the <a href="${process.env.FRONTEND_URL || 'https://trainers.blcompiler.com'}">BLC Admin Portal</a> to review.</p>
    <p>Regards,<br/>BLC Portal System</p>`;
  await sendMail(ADMIN_ALERT_EMAIL, subject, html);
}

// Sends login credentials to a newly created trainer
async function sendTrainerWelcome(trainerEmail, trainerName, password) {
  const loginUrl = process.env.FRONTEND_URL || 'https://trainers.blcompiler.com';
  const subject = `Welcome to BLC Invoice Portal — Your Login Details`;
  const html = `<p>Hi ${trainerName},</p>
    <p>Your trainer account has been created on the <strong>BLC Invoice Portal</strong>.</p>
    <p>
      <strong>Login URL:</strong> <a href="${loginUrl}">${loginUrl}</a><br/>
      <strong>Email:</strong> ${trainerEmail}<br/>
      <strong>Password:</strong> ${password}
    </p>
    <p>Please log in and update your password from your profile settings after your first sign-in.</p>
    <p>Regards,<br/>BLC Admin Team</p>`;
  await sendMail(trainerEmail, subject, html);
}

module.exports = {
  sendInvoiceStatusUpdate,
  sendNewInvoiceAlert,
  sendInvoiceActionAlert,
  sendTrainerWelcome
};
