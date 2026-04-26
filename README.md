# BLC Trainer Invoice & Payment Tracking Portal

A comprehensive, production-ready portal for freelance trainers to submit work details, generate brand-aligned BLC invoices automatically, and track payment status.

## 🚀 Production Setup

1. **Environment Variables**:
   Copy `.env.example` to `.env` in the `backend` directory and fill in the required values.
   ```bash
   cp backend/.env.example backend/.env
   ```

2. **Run in Production**:
   Use the startup script with the `--prod` flag. This will use PM2 if installed, or fallback to standard Node.
   ```bash
   chmod +x run.sh
   ./run.sh --prod
   ```

## 🛠️ Development

To run the portal in development mode with active console logging:
```bash
./run.sh
```

## 🔐 Security & Production Features

- **Helmet**: Hardened HTTP security headers.
- **Structured Logging**: Request logging with `morgan` and structured error handling.
- **Process Management**: Pre-configured `ecosystem.config.js` for PM2 (auto-restart, log management).
- **Role-Based Access**: JWT-based authentication for Trainers and Admins.
- **Sanitized Logs**: Sensitive credentials (admin passwords) are no longer logged to the console on startup.

## 📁 Directory Structure

- `frontend/`: Vanilla HTML/CSS/JS client.
- `backend/`: Node.js Express server.
- `uploads/`: Storage for generated PDFs and trainer signatures.
- `brand_assets/`: Official BLC branding material.

## 🧪 Testing

Run the automated test suite to verify system integrity:
```bash
npm test
```
