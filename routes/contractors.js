const express = require('express');
const router = express.Router();
const db = require('../db/database');
const requireAuth = require('../middleware/auth');

// All routes require auth
router.use(requireAuth);

// GET /contractors
router.get('/', (req, res) => {
  const userId = req.session.userId;

  const contractors = db.prepare(`
    SELECT c.*,
      COUNT(CASE WHEN i.status != 'paid' THEN 1 END) as outstanding_count
    FROM contractors c
    LEFT JOIN invoices i ON i.contractor_id = c.id AND i.user_id = c.user_id
    WHERE c.user_id = ?
    GROUP BY c.id
    ORDER BY c.name ASC
  `).all(userId);

  res.render('contractors/index', { title: 'Contractors', contractors });
});

// GET /contractors/new
router.get('/new', (req, res) => {
  res.render('contractors/new', { title: 'Add Contractor' });
});

// POST /contractors
router.post('/', (req, res) => {
  const userId = req.session.userId;
  const { name, email, default_terms } = req.body;

  if (!name || !name.trim()) {
    req.flash('error', 'Contractor name is required.');
    return res.redirect('/contractors/new');
  }

  const terms = parseInt(default_terms) || 30;
  db.prepare(`
    INSERT INTO contractors (user_id, name, email, default_terms)
    VALUES (?, ?, ?, ?)
  `).run(userId, name.trim(), email ? email.trim() : null, terms);

  req.flash('success', `Contractor "${name.trim()}" added.`);
  res.redirect('/contractors');
});

// GET /contractors/:id/edit
router.get('/:id/edit', (req, res) => {
  const userId = req.session.userId;
  const contractor = db.prepare(
    'SELECT * FROM contractors WHERE id = ? AND user_id = ?'
  ).get(req.params.id, userId);

  if (!contractor) {
    req.flash('error', 'Contractor not found.');
    return res.redirect('/contractors');
  }

  res.render('contractors/edit', { title: 'Edit Contractor', contractor });
});

// POST /contractors/:id
router.post('/:id', (req, res) => {
  const userId = req.session.userId;
  const { name, email, default_terms } = req.body;

  if (!name || !name.trim()) {
    req.flash('error', 'Contractor name is required.');
    return res.redirect(`/contractors/${req.params.id}/edit`);
  }

  const contractor = db.prepare(
    'SELECT id FROM contractors WHERE id = ? AND user_id = ?'
  ).get(req.params.id, userId);

  if (!contractor) {
    req.flash('error', 'Contractor not found.');
    return res.redirect('/contractors');
  }

  const terms = parseInt(default_terms) || 30;
  db.prepare(`
    UPDATE contractors SET name = ?, email = ?, default_terms = ?
    WHERE id = ? AND user_id = ?
  `).run(name.trim(), email ? email.trim() : null, terms, req.params.id, userId);

  req.flash('success', 'Contractor updated.');
  res.redirect('/contractors');
});

// POST /contractors/:id/delete
router.post('/:id/delete', (req, res) => {
  const userId = req.session.userId;

  const contractor = db.prepare(
    'SELECT * FROM contractors WHERE id = ? AND user_id = ?'
  ).get(req.params.id, userId);

  if (!contractor) {
    req.flash('error', 'Contractor not found.');
    return res.redirect('/contractors');
  }

  const invoiceCount = db.prepare(
    'SELECT COUNT(*) as count FROM invoices WHERE contractor_id = ? AND user_id = ?'
  ).get(req.params.id, userId);

  if (invoiceCount.count > 0) {
    req.flash('error', 'Cannot delete contractor with existing invoices.');
    return res.redirect('/contractors');
  }

  db.prepare('DELETE FROM contractors WHERE id = ? AND user_id = ?')
    .run(req.params.id, userId);

  req.flash('success', `Contractor "${contractor.name}" deleted.`);
  res.redirect('/contractors');
});

module.exports = router;
