require('dotenv').config();
const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const { query } = require('../db');
const adminRoutes = require('../routes/admin');
const jwt = require('jsonwebtoken');

const app = express();
app.use(bodyParser.json());
app.use('/api/admin', adminRoutes);

describe('Admin System Tests', () => {
  let adminToken;
  let testTrainerId;

  beforeAll(() => {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('Password@123', 12);
    
    // Create Admin
    const resAdmin = query('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)', ['Super Admin', `admin_${Date.now()}@blc.com`, hash, 'superadmin']);
    adminToken = jwt.sign({ id: resAdmin.lastInsertRowid, role: 'superadmin', name: 'Super Admin' }, process.env.JWT_SECRET);
  });

  afterAll(() => {
    query('PRAGMA foreign_keys = OFF');
    query('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE trainer_id = ?)', [testTrainerId]);
    query('DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE trainer_id = ?)', [testTrainerId]);
    query('DELETE FROM notifications WHERE user_id = ?', [testTrainerId]);
    query('DELETE FROM notifications WHERE invoice_id IN (SELECT id FROM invoices WHERE trainer_id = ?)', [testTrainerId]);
    query('DELETE FROM invoices WHERE trainer_id = ?', [testTrainerId]);
    query('DELETE FROM trainer_profiles WHERE user_id = ?', [testTrainerId]);
    query('DELETE FROM audit_log WHERE actor_id = ? OR entity_id = ?', [testTrainerId, testTrainerId]);
    query("DELETE FROM audit_log WHERE actor_id IN (SELECT id FROM users WHERE name = 'Super Admin')");
    query("DELETE FROM audit_log WHERE entity_id IN (SELECT id FROM users WHERE name = 'Super Admin')");
    query('DELETE FROM users WHERE id = ?', [testTrainerId]);
    query("DELETE FROM users WHERE name = 'Super Admin'");
    query('PRAGMA foreign_keys = ON');
  });

  test('Admin: Create a new trainer', async () => {
    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'New Trainer',
        email: `trainer_${Date.now()}@blc.com`,
        password: 'Password@123',
        role: 'trainer'
      });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('User created successfully');
    testTrainerId = res.body.id;
  });

  test('Admin: Invoice Status Update Validation', async () => {
    // Create a dummy invoice for testing
    const invNo = 'TEST-INV-999';
    const invRes = query('INSERT INTO invoices (invoice_no, trainer_id, subtotal, total, status) VALUES (?,?,?,?,?)', [invNo, testTrainerId, 100, 100, 'submitted']);
    const invoiceId = invRes.lastInsertRowid;

    // Test rejection without remarks
    const resReject = await request(app)
      .patch(`/api/admin/invoices/${invoiceId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'rejected', remarks: 'sh' }); // too short

    expect(resReject.status).toBe(400);
    expect(resReject.body.details).toContainEqual(expect.objectContaining({ remarks: expect.any(String) }));

    // Test paid without payment details
    const resPaid = await request(app)
      .patch(`/api/admin/invoices/${invoiceId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'paid' });

    expect(resPaid.status).toBe(400);
    expect(resPaid.body.details).toContainEqual(expect.objectContaining({ payment_date: expect.any(String) }));
    expect(resPaid.body.details).toContainEqual(expect.objectContaining({ reference_number: expect.any(String) }));

    // Cleanup: Mark the invoice as rejected so it doesn't interfere with other tests
    await request(app)
      .patch(`/api/admin/invoices/${invoiceId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'rejected', remarks: 'Test cleanup rejection' });
  });

  test('Admin: Cannot deactivate trainer with active invoices', async () => {
    // 1. Create a dummy invoice for our test trainer
    const invNo = `DEACTIV-TEST-${Date.now()}`;
    const invRes = query('INSERT INTO invoices (invoice_no, trainer_id, subtotal, total, status) VALUES (?,?,?,?,?)', [invNo, testTrainerId, 500, 500, 'submitted']);
    const invoiceId = invRes.lastInsertRowid;

    // 2. Attempt to deactivate the trainer - should fail
    const resDeactivateFail = await request(app)
      .delete(`/api/admin/users/${testTrainerId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    
    expect(resDeactivateFail.status).toBe(400);
    expect(resDeactivateFail.body.error).toBe('Cannot deactivate trainer with pending or active invoices. Please resolve them first.');

    // 3. Update the invoice to a resolved status
    await request(app)
      .patch(`/api/admin/invoices/${invoiceId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'paid', payment_date: '2025-01-01', reference_number: 'PAY-123' });

    // 4. Attempt to deactivate again - should succeed
    const resDeactivateSuccess = await request(app)
      .delete(`/api/admin/users/${testTrainerId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resDeactivateSuccess.status).toBe(200);
    expect(resDeactivateSuccess.body.message).toBe('User deactivated');

    // 5. Verify user is inactive
    const user = query('SELECT is_active FROM users WHERE id = ?', [testTrainerId])[0];
    expect(user.is_active).toBe(0);
  });
});
