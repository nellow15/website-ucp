"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = require("../database");
const router = (0, express_1.Router)();
// API to check username availability
router.get('/check-username/:username', async (req, res) => {
    try {
        const [rows] = await database_1.pool.execute('SELECT Username FROM accounts WHERE Username = ?', [req.params.username]);
        res.json({ available: rows.length === 0 });
    }
    catch (error) {
        console.error('API error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// API to check email availability
router.get('/check-email/:email', async (req, res) => {
    try {
        const [rows] = await database_1.pool.execute('SELECT Email FROM accounts WHERE Email = ?', [req.params.email]);
        res.json({ available: rows.length === 0 });
    }
    catch (error) {
        console.error('API error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// API to get user stats
router.get('/user-stats/:username', async (req, res) => {
    try {
        const [rows] = await database_1.pool.execute('SELECT Username, Email, PhoneNumber, CreatedAt, LastLogin FROM accounts WHERE Username = ?', [req.params.username]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(rows[0]);
    }
    catch (error) {
        console.error('API error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// API untuk verify login (backward compatibility)
router.post('/verify-login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        const [rows] = await database_1.pool.execute('SELECT * FROM accounts WHERE Username = ?', [username]);
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const user = rows[0];
        // Check if password and salt exist
        if (!user.Password || !user.Salt) {
            return res.status(401).json({ error: 'Account not properly configured' });
        }
        // For this API, we can't hash the password without knowing the algorithm
        // This is just a placeholder - in real implementation you'd verify the password
        res.json({
            success: true,
            user: {
                id: user.ID,
                username: user.Username,
                email: user.Email,
                phone: user.PhoneNumber,
                verifyCode: user.VerifyCode
            }
        });
    }
    catch (error) {
        console.error('API error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
