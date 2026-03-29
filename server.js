require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev_secret_change_me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(flash());

// Make flash + user available in all views
app.use((req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.currentUser = req.session.userId
    ? { id: req.session.userId, email: req.session.userEmail, name: req.session.userName }
    : null;
  next();
});

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/dashboard'));
app.use('/contractors', require('./routes/contractors'));
app.use('/invoices', require('./routes/invoices'));

// Start reminder cron
require('./services/reminders');

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ContractorPay running on port ${PORT}`);
});
