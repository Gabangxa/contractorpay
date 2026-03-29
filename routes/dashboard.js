const express = require('express');
const router = express.Router();
const db = require('../db/database');
const requireAuth = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const today = new Date().toISOString().split('T')[0];

  // Auto-update statuses for all non-paid invoices
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

  // Due today
  const dueToday = db.prepare(`
    SELECT * FROM invoices
    WHERE user_id = ? AND status != 'paid' AND due_date = ?
  `).all(userId, today);

  // Due this week (tomorrow to +7 days)
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndStr = weekEnd.toISOString().split('T')[0];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const dueThisWeek = db.prepare(`
    SELECT * FROM invoices
    WHERE user_id = ? AND status != 'paid'
      AND due_date >= ? AND due_date <= ?
  `).all(userId, tomorrowStr, weekEndStr);

  // Overdue
  const overdue = db.prepare(`
    SELECT * FROM invoices
    WHERE user_id = ? AND status = 'overdue'
  `).all(userId);

  // Paid this month
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartStr = monthStart.toISOString().split('T')[0];

  const paidThisMonth = db.prepare(`
    SELECT * FROM invoices
    WHERE user_id = ? AND status = 'paid'
      AND date(paid_at) >= ?
  `).all(userId, monthStartStr);

  // Full invoice list: all non-paid + paid in last 30 days, joined with contractor
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

  const invoices = db.prepare(`
    SELECT i.*, c.name as contractor_name
    FROM invoices i
    JOIN contractors c ON i.contractor_id = c.id
    WHERE i.user_id = ?
      AND (i.status != 'paid' OR date(i.paid_at) >= ?)
    ORDER BY i.due_date ASC
  `).all(userId, thirtyDaysAgoStr);

  // Compute summary totals
  const sumAmount = (list) => list.reduce((acc, inv) => acc + inv.amount, 0);

  res.render('dashboard', {
    title: 'Dashboard',
    today,
    stats: {
      dueToday: { count: dueToday.length, total: sumAmount(dueToday) },
      dueThisWeek: { count: dueThisWeek.length, total: sumAmount(dueThisWeek) },
      overdue: { count: overdue.length, total: sumAmount(overdue) },
      paidThisMonth: { count: paidThisMonth.length, total: sumAmount(paidThisMonth) }
    },
    invoices
  });
});

module.exports = router;
