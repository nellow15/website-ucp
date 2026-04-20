"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../database");
const express_validator_1 = require("express-validator");
const router = (0, express_1.Router)();
// Fungsi untuk hash password dengan salt sesuai dengan format yang diberikan
function hashPassword(password, salt) {
    return crypto_1.default
        .createHash("sha256")
        .update(password + salt, "utf8")
        .digest("hex")
        .toUpperCase();
}
// ============ ROUTES ============
// Login Page
router.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('login', {
        title: 'Login'
    });
});
// Register Page (DIAKTIFKAN KEMBALI)
router.get('/register', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('register', {
        title: 'Register'
    });
});
// Login Code Page (DIHAPUS - tidak digunakan lagi)
router.get('/login-code', (req, res) => {
    req.flash('error_msg', 'Login code system is no longer available');
    res.redirect('/login');
});
// ============ LOGIN HANDLER ============
router.post('/login', [
    (0, express_validator_1.body)('username').notEmpty().withMessage('Username is required'),
    (0, express_validator_1.body)('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        req.flash('error_msg', errors.array()[0].msg);
        return res.redirect('/login');
    }
    const { username, password } = req.body;
    try {
        // Check if username exists
        const [rows] = await database_1.pool.execute('SELECT * FROM accounts WHERE Username = ?', [username]);
        if (rows.length === 0) {
            req.flash('error_msg', 'Invalid username or password');
            return res.redirect('/login');
        }
        const user = rows[0];
        // Check if user has Password and Salt columns
        if (!user.Password || !user.Salt) {
            req.flash('error_msg', 'Your account password is not set. Please contact administrator.');
            return res.redirect('/login');
        }
        // Hash the provided password with stored salt
        const hashedPassword = hashPassword(password, user.Salt);
        // Compare with stored password
        if (hashedPassword !== user.Password) {
            req.flash('error_msg', 'Invalid username or password');
            return res.redirect('/login');
        }
        // Update last login
        await database_1.pool.execute('UPDATE accounts SET LastLogin = CURRENT_TIMESTAMP WHERE Username = ?', [username]);
        const ip = req.headers['cf-connecting-ip'] ||
            req.headers['x-forwarded-for']?.split(',')[0] ||
            req.socket.remoteAddress;
        await database_1.pool.execute(`INSERT INTO login_history (AccountID, IPAddress, LoginTime)
            VALUES (?, ?, NOW())`, [user.ID, ip]);
        // Set session
        req.session.user = {
            id: user.ID,
            username: user.Username,
            email: user.Email,
            phone: user.PhoneNumber,
            verifyCode: user.VerifyCode
        };
        res.redirect('/dashboard');
    }
    catch (error) {
        console.error('Login error:', error);
        req.flash('error_msg', 'An error occurred. Please try again.');
        res.redirect('/login');
    }
});
// ============ REGISTER HANDLER (DIAKTIFKAN KEMBALI) ============
router.post('/register', [
    (0, express_validator_1.body)('username')
        .notEmpty().withMessage('Username is required')
        .isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
    (0, express_validator_1.body)('email')
        .notEmpty().withMessage('Email is required')
        .isEmail().withMessage('Invalid email format'),
    (0, express_validator_1.body)('phone')
        .optional()
        .matches(/^[0-9+\-\s()]+$/).withMessage('Invalid phone number format'),
    (0, express_validator_1.body)('password')
        .notEmpty().withMessage('Password is required')
        .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    (0, express_validator_1.body)('confirmPassword')
        .notEmpty().withMessage('Confirm password is required')
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        req.flash('error_msg', errors.array()[0].msg);
        return res.redirect('/register');
    }
    const { username, email, phone, password, confirmPassword } = req.body;
    // Check if passwords match
    if (password !== confirmPassword) {
        req.flash('error_msg', 'Passwords do not match');
        return res.redirect('/register');
    }
    try {
        // Check if username already exists
        const [usernameRows] = await database_1.pool.execute('SELECT Username FROM accounts WHERE Username = ?', [username]);
        if (usernameRows.length > 0) {
            req.flash('error_msg', 'Username already exists');
            return res.redirect('/register');
        }
        // Check if email already exists
        const [emailRows] = await database_1.pool.execute('SELECT Email FROM accounts WHERE Email = ?', [email]);
        if (emailRows.length > 0) {
            req.flash('error_msg', 'Email already registered');
            return res.redirect('/register');
        }
        // Check if phone already exists (if provided)
        if (phone) {
            const [phoneRows] = await database_1.pool.execute('SELECT PhoneNumber FROM accounts WHERE PhoneNumber = ?', [phone]);
            if (phoneRows.length > 0) {
                req.flash('error_msg', 'Phone number already registered');
                return res.redirect('/register');
            }
        }
        // Generate salt
        const salt = crypto_1.default.randomBytes(16).toString('hex');
        // Hash password with salt
        const hashedPassword = hashPassword(password, salt);
        // Generate verification code
        const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();
        // Insert new user into database
        const [result] = await database_1.pool.execute(`INSERT INTO accounts (Username, Password, Salt, Email, PhoneNumber, VerifyCode, IsVerified, CreatedAt) 
             VALUES (?, ?, ?, ?, ?, ?, FALSE, CURRENT_TIMESTAMP)`, [username, hashedPassword, salt, email, phone || null, verifyCode]);
        // Automatically log in the user after registration
        req.session.user = {
            id: result.insertId,
            username: username,
            email: email,
            phone: phone || null,
            verifyCode: verifyCode
        };
        // You might want to send verification email here
        // For now, redirect to dashboard
        req.flash('success_msg', 'Registration successful! Welcome to our platform.');
        res.redirect('/dashboard');
    }
    catch (error) {
        console.error('Registration error:', error);
        req.flash('error_msg', 'An error occurred during registration. Please try again.');
        res.redirect('/register');
    }
});
// ============ EMAIL-BASED LOGIN FLOW (DIHAPUS - tidak digunakan lagi) ============
// Request Login Code via Email (DIHAPUS)
router.post('/request-login-code', (req, res) => {
    req.flash('error_msg', 'Email login system is no longer available. Please use username and password.');
    res.redirect('/login');
});
// Verify Login Code (DIHAPUS)
router.post('/verify-login-code', (req, res) => {
    req.flash('error_msg', 'Email login system is no longer available. Please use username and password.');
    res.redirect('/login');
});
// ============ LOGOUT ============
// Logout Handler
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
        }
        res.redirect('/');
    });
});
// ============ API ENDPOINTS ============
// API untuk check username availability
router.get('/api/check-username/:username', async (req, res) => {
    try {
        const [rows] = await database_1.pool.execute('SELECT Username FROM accounts WHERE Username = ?', [req.params.username]);
        res.json({ available: rows.length === 0 });
    }
    catch (error) {
        console.error('API error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// API untuk check email availability
router.get('/api/check-email/:email', async (req, res) => {
    try {
        const [rows] = await database_1.pool.execute('SELECT Email FROM accounts WHERE Email = ?', [req.params.email]);
        res.json({ available: rows.length === 0 });
    }
    catch (error) {
        console.error('API error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// API untuk check phone availability
router.get('/api/check-phone/:phone', async (req, res) => {
    try {
        const [rows] = await database_1.pool.execute('SELECT PhoneNumber FROM accounts WHERE PhoneNumber = ?', [req.params.phone]);
        res.json({ available: rows.length === 0 });
    }
    catch (error) {
        console.error('API error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// API untuk create user (internal use only)
router.post('/api/create-user', [
    (0, express_validator_1.body)('username').notEmpty(),
    (0, express_validator_1.body)('password').notEmpty(),
    (0, express_validator_1.body)('email').optional().isEmail(),
    (0, express_validator_1.body)('phone').optional(),
    (0, express_validator_1.body)('verifyCode').optional()
], async (req, res) => {
    // Basic authentication check
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_TOKEN || 'admin-secret'}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { username, password, email, phone, verifyCode } = req.body;
    try {
        // Check if username exists
        const [usernameRows] = await database_1.pool.execute('SELECT Username FROM accounts WHERE Username = ?', [username]);
        if (usernameRows.length > 0) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        // Generate salt
        const salt = crypto_1.default.randomBytes(16).toString('hex');
        // Hash password with salt
        const hashedPassword = hashPassword(password, salt);
        // Generate verify code if not provided
        const finalVerifyCode = verifyCode || Math.floor(100000 + Math.random() * 900000).toString();
        // Insert user with password and salt
        const [result] = await database_1.pool.execute(`INSERT INTO accounts (Username, Password, Salt, Email, PhoneNumber, VerifyCode, IsVerified, CreatedAt) 
             VALUES (?, ?, ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP)`, [username, hashedPassword, salt, email || null, phone || null, finalVerifyCode]);
        res.json({
            success: true,
            userId: result.insertId,
            username: username,
            verifyCode: finalVerifyCode
        });
    }
    catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// API untuk update user password
router.post('/api/update-password', [
    (0, express_validator_1.body)('username').notEmpty(),
    (0, express_validator_1.body)('password').notEmpty()
], async (req, res) => {
    // Basic authentication check
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_TOKEN || 'admin-secret'}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { username, password } = req.body;
    try {
        // Check if username exists
        const [rows] = await database_1.pool.execute('SELECT ID FROM accounts WHERE Username = ?', [username]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        // Generate new salt
        const salt = crypto_1.default.randomBytes(16).toString('hex');
        // Hash new password with salt
        const hashedPassword = hashPassword(password, salt);
        // Update user password and salt
        await database_1.pool.execute('UPDATE accounts SET Password = ?, Salt = ? WHERE Username = ?', [hashedPassword, salt, username]);
        res.json({
            success: true,
            message: 'Password updated successfully'
        });
    }
    catch (error) {
        console.error('Update password error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
