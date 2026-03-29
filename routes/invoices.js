const express = require('express');
const router = express.Router();
const db = require('../db/database');
const requireAuth = require('../middleware/auth');
const nodemailer = require('nodemailer');

// All routes require auth
router.use(requireAuth);

function computeStatus(dueDateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((due - today) / 86400000);
  if (diffDays < 0) return 'overdue';
  if (diffDays <= 3) return 'due-soon';
  return 'pending';
}

function getDaysLabel(dueDateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);
  const diff = Math.floor((due - today) / 86400000);
  if (diff === 0) return 'Due today';
  if (diff > 0) return `In ${diff} day${diff !== 1 ? 's' : ''}`;
  return `${Math.abs(diff)} day${Math.abs(diff) !== 1 ? 's' : ''} overdue`;
}

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.ethereal.email',
    port: parseInt(process.env.SMTP_PORT || '587'),
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || ''
    }
  });
}

// Auto-update statuses helper
function refreshStatuses(userId) {
  db.prepare(`
    UPDATE invoices SET
      status = CASE
        WHEN julianday(due_date) - julianday('now') < 0 THEN 'overdue'
        WHEN julianday(due_date) - julianday('now') <= 3 THEN 'due-soon'
        ELSE 'pending'
      END,
      updated_at = datetime('now')
    WHERE status != 'paid' AND user_id = ?
  `).run(userId);
}

// GET /invoices
router.get('/', (req, res) => {
  const userId = req.session.userId;
  const filter = req.query.status || 'all';

  refreshStatuses(userId);

  let query = `
    SELECT i.*, c.name as contractor_name
    FROM invoices i
    JOIN contractors c ON i.contractor_id = c.id
    WHERE i.user_id = ?
  `;
  const params = [userId];

  if (filter !== 'all') {
    query += ' AND i.status = ?';
    params.push(filter);
  }

  query += ' ORDER BY i.due_date ASC';

  const invoices = db.prepare(query).all(...params);
  const invoicesWithDays = invoices.map(inv => ({
    ...inv,
    daysLabel: getDaysLabel(inv.due_date)
  }));

  res.render('invoices/index', {
    title: 'Invoices',
    invoices: invoicesWithDays,
    filter
  });
});

// GET /invoices/new
router.get('/new', (req, res) => {
  const userId = req.session.userId;
  const contractors = db.prepare(
    'SELECT * FROM contractors WHERE user_id = ? ORDER BY name ASC'
  ).all(userId);

  if (contractors.length === 0) {
    req.flash('error', 'Please add a contractor before creating an invoice.');
    return res.redirect('/contractors/new');
  }

  res.render('invoices/new', { title: 'Add Invoice', contractors });
});

// POST /invoices
router.post('/', async (req, res) => {
  const userId = req.session.userId;
  const {
    contractor_id, invoice_number, amount, invoice_date,
    due_date, notes, send_confirmation
  } = req.body;

  if (!contractor_id || !amount || !invoice_date || !due_date) {
    req.flash('error', 'Contractor, amount, invoice date, and due date are required.');
    return res.redirect('/invoices/new');
  }

  // Verify contractor belongs to user
  const contractor = db.prepare(
    'SELECT * FROM contractors WHERE id = ? AND user_id = ?'
  ).get(contractor_id, userId);

  if (!contractor) {
    req.flash('error', 'Invalid contractor selected.');
    return res.redirect('/invoices/new');
  }

  const status = computeStatus(due_date);
  const parsedAmount = parseFloat(amount);

  const result = db.prepare(`
    INSERT INTO invoices (user_id, contractor_id, invoice_number, amount, invoice_date, due_date, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    contractor_id,
    invoice_number ? invoice_number.trim() : null,
    parsedAmount,
    invoice_date,
    due_date,
    status,
    notes ? notes.trim() : null
  );

  // Optional: send confirmation email to contractor
  if (send_confirmation === 'on' && contractor.email) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const invNum = invoice_number ? invoice_number.trim() : null;
    const subject = `Invoice received: ${invNum ? '#' + invNum + ' ' : ''}for $${parsedAmount.toFixed(2)}`;
    const body = `Your invoice${invNum ? ' #' + invNum : ''} for $${parsedAmount.toFixed(2)} has been received. We'll process payment by ${due_date}. — ${user.name}`;

    try {
      const transporter = getTransporter();
      await transporter.sendMail({
        from: process.env.SMTP_USER || 'noreply@contractorpay.app',
        to: contractor.email,
        subject,
        text: body
      });
      console.log(`[invoices] Sent confirmation to ${contractor.email}`);
    } catch (err) {
      console.error('[invoices] Failed to send confirmation email:', err.message);
      // Don't fail the whole request
    }
  }

  req.flash('success', 'Invoice created.');
  res.redirect('/');
});

// GET /invoices/:id/edit
router.get('/:id/edit', (req, res) => {
  const userId = req.session.userId;

  const invoice = db.prepare(
    'SELECT * FROM invoices WHERE id = ? AND user_id = ?'
  ).get(req.params.id, userId);

  if (!invoice) {
    req.flash('error', 'Invoice not found.');
    return res.redirect('/invoices');
  }

  const contractors = db.prepare(
    'SELECT * FROM contractors WHERE user_id = ? ORDER BY name ASC'
  ).all(userId);

  res.render('invoices/edit', { title: 'Edit Invoice', invoice, contractors });
});

// POST /invoices/:id
router.post('/:id', (req, res) => {
  const userId = req.session.userId;
  const {
    contractor_id, invoice_number, amount, invoice_date,
    due_date, notes
  } = req.body;

  if (!contractor_id || !amount || !invoice_date || !due_date) {
    req.flash('error', 'Contractor, amount, invoice date, and due date are required.');
    return res.redirect(`/invoices/${req.params.id}/edit`);
  }

  const invoice = db.prepare(
    'SELECT * FROM invoices WHERE id = ? AND user_id = ?'
  ).get(req.params.id, userId);

  if (!invoice) {
    req.flash('error', 'Invoice not found.');
    return res.redirect('/invoices');
  }

  // Don't change status if already paid
  const newStatus = invoice.status === 'paid' ? 'paid' : computeStatus(due_date);

  db.prepare(`
    UPDATE invoices SET
      contractor_id = ?, invoice_number = ?, amount = ?,
      invoice_date = ?, due_date = ?, status = ?, notes = ?,
      updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(
    contractor_id,
    invoice_number ? invoice_number.trim() : null,
    parseFloat(amount),
    invoice_date,
    due_date,
    newStatus,
    notes ? notes.trim() : null,
    req.params.id,
    userId
  );

  req.flash('success', 'Invoice updated.');
  res.redirect('/invoices');
});

// POST /invoices/:id/delete
router.post('/:id/delete', (req, res) => {
  const userId = req.session.userId;

  const invoice = db.prepare(
    'SELECT * FROM invoices WHERE id = ? AND user_id = ?'
  ).get(req.params.id, userId);

  if (!invoice) {
    req.flash('error', 'Invoice not found.');
    return res.redirect('/invoices');
  }

  db.prepare('DELETE FROM invoices WHERE id = ? AND user_id = ?')
    .run(req.params.id, userId);

  req.flash('success', 'Invoice deleted.');
  res.redirect('/invoices');
});

// POST /invoices/:id/mark-paid
router.post('/:id/mark-paid', (req, res) => {
  const userId = req.session.userId;

  const invoice = db.prepare(
    'SELECT * FROM invoices WHERE id = ? AND user_id = ?'
  ).get(req.params.id, userId);

  if (!invoice) {
    req.flash('error', 'Invoice not found.');
    return res.redirect('/');
  }

  db.prepare(`
    UPDATE invoices SET status = 'paid', paid_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(req.params.id, userId);

  req.flash('success', 'Invoice marked as paid.');
  const referer = req.headers.referer || '/';
  res.redirect(referer);
});

module.exports = router;
