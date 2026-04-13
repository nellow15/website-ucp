"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = require("../database");
const nodemailer_1 = __importDefault(require("nodemailer"));
const axios_1 = __importDefault(require("axios"));
const router = (0, express_1.Router)();
// ─── Email Transporter ────────────────────────────────────────────────────────
const transporter = nodemailer_1.default.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD,
    },
});
// ─── Discord OAuth Config ─────────────────────────────────────────────────────
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = `${process.env.BASE_URL}/verify/discord/callback`;
// ─── Helper: generate 6-digit OTP ────────────────────────────────────────────
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}
// ─── [1] Send Email OTP ────────────────────────────────────────────────────────
// POST /verify/email/send
router.post('/email/send', async (req, res) => {
    try {
        const session = req.session;
        if (!session?.user)
            return res.status(401).json({ error: 'Not logged in' });
        const userId = session.user.id;
        const userEmail = session.user.email;
        // Generate OTP & expiry (10 minutes)
        const otp = generateOTP();
        const expiry = new Date(Date.now() + 10 * 60 * 1000);
        // Save OTP to DB
        await database_1.pool.execute('UPDATE accounts SET EmailOTP = ?, EmailOTPExpiry = ? WHERE ID = ?', [otp, expiry, userId]);
        // Send email
        await transporter.sendMail({
            from: `"CENTRA ROLEPLAY" <${process.env.EMAIL_USER}>`,
            to: userEmail,
            subject: 'Email Verification Code – CENTRA ROLEPLAY',
            html: `
                <div style="font-family:Inter,Arial,sans-serif;max-width:500px;margin:0 auto;padding:2rem;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
                    <h2 style="margin:0 0 1rem;color:#111827;">CENTRA ROLEPLAY</h2>
                    <p style="color:#6b7280;">Your email verification code is:</p>
                    <div style="font-size:2.5rem;font-weight:700;letter-spacing:8px;color:#000;background:#f9fafb;padding:1rem;border-radius:8px;text-align:center;margin:1.5rem 0;">
                        ${otp}
                    </div>
                    <p style="color:#6b7280;font-size:0.875rem;">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
                </div>
            `,
        });
        res.json({ success: true });
    }
    catch (err) {
        console.error('[verify/email/send]', err);
        res.status(500).json({ error: 'Failed to send OTP' });
    }
});
// ─── [2] Verify Email OTP ─────────────────────────────────────────────────────
// POST /verify/email/confirm
router.post('/email/confirm', async (req, res) => {
    try {
        const session = req.session;
        if (!session?.user)
            return res.status(401).json({ error: 'Not logged in' });
        const { otp } = req.body;
        if (!otp)
            return res.status(400).json({ error: 'OTP is required' });
        const userId = session.user.id;
        const [rows] = await database_1.pool.execute('SELECT EmailOTP, EmailOTPExpiry FROM accounts WHERE ID = ?', [userId]);
        if (!rows.length)
            return res.status(404).json({ error: 'User not found' });
        const { EmailOTP, EmailOTPExpiry } = rows[0];
        if (!EmailOTP || !EmailOTPExpiry)
            return res.status(400).json({ error: 'No OTP requested' });
        if (new Date() > new Date(EmailOTPExpiry))
            return res.status(400).json({ error: 'OTP has expired' });
        if (otp.trim() !== EmailOTP)
            return res.status(400).json({ error: 'Invalid OTP' });
        // Mark verified & clear OTP
        await database_1.pool.execute('UPDATE accounts SET EmailVerified = 1, EmailOTP = NULL, EmailOTPExpiry = NULL WHERE ID = ?', [userId]);
        // Update session
        session.user.emailVerified = true;
        res.json({ success: true });
    }
    catch (err) {
        console.error('[verify/email/confirm]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ─── [3] Discord OAuth – Redirect to Discord ──────────────────────────────────
// GET /verify/discord
router.get('/discord', (req, res) => {
    const session = req.session;
    if (!session?.user)
        return res.redirect('/login');
    const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        redirect_uri: DISCORD_REDIRECT_URI,
        response_type: 'code',
        scope: 'identify email',
    });
    res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});
// ─── [4] Discord OAuth – Callback ─────────────────────────────────────────────
// GET /verify/discord/callback
router.get('/discord/callback', async (req, res) => {
    try {
        const session = req.session;
        if (!session?.user)
            return res.redirect('/login');
        const { code, error } = req.query;
        if (error || !code)
            return res.redirect('/dashboard?discord=error');
        // Exchange code for token
        const tokenRes = await axios_1.default.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: DISCORD_CLIENT_ID,
            client_secret: DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: DISCORD_REDIRECT_URI,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const { access_token } = tokenRes.data;
        // Fetch Discord user info
        const userRes = await axios_1.default.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` },
        });
        const { id: discordId, username: discordUsername, avatar } = userRes.data;
        const discordAvatar = avatar
            ? `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png`
            : null;
        const userId = session.user.id;
        // Check if Discord ID already linked to another account
        const [existing] = await database_1.pool.execute('SELECT ID FROM accounts WHERE DiscordID = ? AND ID != ?', [discordId, userId]);
        if (existing.length > 0) {
            return res.redirect('/dashboard?discord=taken');
        }
        // Save Discord info
        await database_1.pool.execute('UPDATE accounts SET DiscordVerified = 1, DiscordID = ?, DiscordUsername = ?, DiscordAvatar = ? WHERE ID = ?', [discordId, discordUsername, discordAvatar, userId]);
        // Update session
        session.user.discordVerified = true;
        session.user.discordUsername = discordUsername;
        res.redirect('/dashboard?discord=success');
    }
    catch (err) {
        console.error('[verify/discord/callback]', err);
        res.redirect('/dashboard?discord=error');
    }
});
exports.default = router;
