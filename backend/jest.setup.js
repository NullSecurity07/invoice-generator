// jest.setup.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'test-admin@blc.com';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Password@123';

// Mock the email service to prevent actual emails from being sent during tests
jest.mock('./services/email', () => ({
  sendTrainerWelcome: jest.fn(),
  sendInvoiceStatusUpdate: jest.fn(),
  sendPasswordReset: jest.fn(),
  sendInvoiceActionAlert: jest.fn(),
}));
