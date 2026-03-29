module.exports = function requireAuth(req, res, next) {
  if (!req.session.userId) {
    req.flash('error', 'Please log in to continue.');
    return res.redirect('/login');
  }
  next();
};
