const cron = require('node-cron');
const nodemailer = require('nodemailer');
const db = require('../db/database');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: parseInt(process.env.SMTP_PORT || '587'),
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  }
});

async function sendReminderEmails() {
  const today = new Date().toISOString().split('T')[0];

  // Query invoices not paid, joined with contractor and user
  const invoices = db.prepare(`
    SELECT i.*, c.name as contractor_name, u.email as user_email, u.name as user_name
    FROM invoices i
    JOIN contractors c ON i.contractor_id = c.id
    JOIN users u ON i.user_id = u.id
    WHERE i.status != 'paid'
  `).all();

  for (const inv of invoices) {
    const dueDate = new Date(inv.due_date);
    const todayDate = new Date(today);
    const diffDays = Math.floor((dueDate - todayDate) / 86400000);

    let subject, body;
    if (diffDays === 3) {
      subject = `Payment reminder: Invoice from ${inv.contractor_name} due in 3 days`;
      body = `Invoice from ${inv.contractor_name} for $${inv.amount.toFixed(2)} is due in 3 days (${inv.due_date}).`;
    } else if (diffDays === 0) {
      subject = `Due today: Invoice from ${inv.contractor_name} for $${inv.amount.toFixed(2)}`;
      body = `Invoice from ${inv.contractor_name} for $${inv.amount.toFixed(2)} is due today.`;
    } else if (diffDays === -1) {
      subject = `Overdue: Invoice from ${inv.contractor_name} was due yesterday`;
      body = `Invoice from ${inv.contractor_name} for $${inv.amount.toFixed(2)} was due yesterday (${inv.due_date}).`;
    } else if (diffDays === -3) {
      subject = `Still overdue: Invoice from ${inv.contractor_name} is 3 days overdue`;
      body = `Invoice from ${inv.contractor_name} for $${inv.amount.toFixed(2)} is 3 days overdue (due ${inv.due_date}).`;
    } else if (diffDays === -7) {
      subject = `7 days overdue: Invoice from ${inv.contractor_name}`;
      body = `Invoice from ${inv.contractor_name} for $${inv.amount.toFixed(2)} is 7 days overdue (due ${inv.due_date}).`;
    } else {
      continue;
    }

    try {
      await transporter.sendMail({
        from: process.env.SMTP_USER || 'noreply@contractorpay.app',
        to: inv.user_email,
        subject,
        text: body
      });
      console.log(`[reminders] Sent "${subject}" to ${inv.user_email}`);
    } catch (err) {
      console.error(`[reminders] Failed to send to ${inv.user_email}:`, err.message);
    }
  }
}

// Daily at 08:00
cron.schedule('0 8 * * *', () => {
  console.log('[reminders] Running daily reminder check...');
  sendReminderEmails().catch(console.error);
});

console.log('[reminders] Cron job scheduled (daily 08:00)');

module.exports = { sendReminderEmails };
