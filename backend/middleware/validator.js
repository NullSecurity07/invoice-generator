const { validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return next();
  }
  const extractedErrors = [];
  errors.array().map(err => extractedErrors.push({ [err.path]: err.msg }));

  // Take the first error message as the primary error string for better UI feedback
  const firstError = errors.array()[0].msg;

  return res.status(400).json({
    error: firstError || 'Validation failed',
    details: extractedErrors
  });
};

module.exports = {
  validate
};
