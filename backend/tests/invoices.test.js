const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const { query } = require('../db');
const authRoutes = require('../routes/auth');
const invoiceRoutes = require('../routes/invoices');
const adminRoutes = require('../routes/admin');
const { authenticate } = require('../middleware/auth');

// Mock server
const app = express();
app.use(bodyParser.json());

// Helper to get token
let trainerAToken, trainerBToken, adminToken;

describe('Invoice System Tests', () => {
  beforeAll(async () => {
    // Setup test users if they don't exist
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('Password@123', 12);
    
    // Cleanup
    query('DELETE FROM invoice_items');
    query('DELETE FROM payments');
    query('DELETE FROM notifications');
    query('DELETE FROM invoices');
    query('DELETE FROM audit_log');
    query("DELETE FROM trainer_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'test%')");
    query("DELETE FROM users WHERE email LIKE 'test%'");

    // Create Trainer A
    const resA = query('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)', ['Trainer A', 'test_trainer_a@blc.com', hash, 'trainer']);
    query('INSERT INTO trainer_profiles (user_id) VALUES (?)', [resA.lastInsertRowid]);

    // Create Trainer B
    const resB = query('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)', ['Trainer B', 'test_trainer_b@blc.com', hash, 'trainer']);
    query('INSERT INTO trainer_profiles (user_id) VALUES (?)', [resB.lastInsertRowid]);

    // Create Admin
    const resAdmin = query('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)', ['Admin', 'test_admin@blc.com', hash, 'admin']);

    // Get Tokens (Sign directly to save time/dependencies)
    const jwt = require('jsonwebtoken');
    trainerAToken = jwt.sign({ id: resA.lastInsertRowid, role: 'trainer', name: 'Trainer A' }, process.env.JWT_SECRET);
    trainerBToken = jwt.sign({ id: resB.lastInsertRowid, role: 'trainer', name: 'Trainer B' }, process.env.JWT_SECRET);
    adminToken = jwt.sign({ id: resAdmin.lastInsertRowid, role: 'admin', name: 'Admin' }, process.env.JWT_SECRET);
  });

  app.use('/api/invoices', invoiceRoutes);

  test('Global Invoice Incrementing: Trainer A creates INV 0001, Trainer B creates INV 0002', async () => {
    const year = new Date().getFullYear();
    
    // 1. Trainer A creates an invoice
    const res1 = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${trainerAToken}`)
      .send({
        training_college: 'College A',
        training_period: 'Aug 2024',
        place_of_supply: 'State A',
        items: [{ particulars: 'Lecture', rate: 1000, qty: 1 }]
      });

    expect(res1.status).toBe(201);
    expect(res1.body.invoice_no).toBe(`BLC-INV-${year}-0001`);

    // 2. Trainer B creates an invoice
    const res2 = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${trainerBToken}`)
      .send({
        training_college: 'College B',
        training_period: 'Aug 2024',
        place_of_supply: 'State B',
        items: [{ particulars: 'Workshop', rate: 2000, qty: 1 }]
      });

    expect(res2.status).toBe(201);
    expect(res2.body.invoice_no).toBe(`BLC-INV-${year}-0002`);

    // 3. Trainer A creates another one
    const res3 = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${trainerAToken}`)
      .send({
        training_college: 'College C',
        training_period: 'Aug 2024',
        place_of_supply: 'State C',
        items: [{ particulars: 'Consultation', rate: 500, qty: 1 }]
      });

    expect(res3.status).toBe(201);
    expect(res3.body.invoice_no).toBe(`BLC-INV-${year}-0003`);
  });

  test('Input Validation: Should fail if required fields are missing', async () => {
    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${trainerAToken}`)
      .send({
        training_college: 'AB', // too short
        items: [] // empty
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Training college/venue name must be at least 3 characters');
  });
});
