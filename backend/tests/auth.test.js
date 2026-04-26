const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const { query } = require('../db');
const authRoutes = require('../routes/auth');
const jwt = require('jsonwebtoken');

const app = express();
app.use(bodyParser.json());
app.use('/api/auth', authRoutes);

describe('Auth System Tests', () => {
  let testUserId;
  const testEmail = `test_auth_${Date.now()}@example.com`;
  const testPassword = 'Password@123';

  beforeAll(() => {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(testPassword, 12);
    const result = query('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)', ['Auth Tester', testEmail, hash, 'trainer']);
    testUserId = result.lastInsertRowid;
    query('INSERT INTO trainer_profiles (user_id) VALUES (?)', [testUserId]);
  });

  afterAll(() => {
    query('DELETE FROM notifications WHERE user_id = ?', [testUserId]);
    query('DELETE FROM audit_log WHERE actor_id = ?', [testUserId]);
    query('DELETE FROM trainer_profiles WHERE user_id = ?', [testUserId]);
    query('DELETE FROM users WHERE id = ?', [testUserId]);
  });

  test('Login with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: testEmail, password: testPassword });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe(testEmail);
  });

  test('Login with invalid password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: testEmail, password: 'WrongPassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  test('Input Validation: Login with invalid email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: 'somepassword' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Enter a valid email address');
  });

  test('Profile Update Validation', async () => {
    const token = jwt.sign({ id: testUserId, role: 'trainer' }, process.env.JWT_SECRET);
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        pan: 'INVALID-PAN',
        ifsc: 'NOT-IFSC'
      });

    expect(res.status).toBe(400);
    expect(res.body.details).toContainEqual(expect.objectContaining({ pan: expect.any(String) }));
    expect(res.body.details).toContainEqual(expect.objectContaining({ ifsc: expect.any(String) }));
  });
});
