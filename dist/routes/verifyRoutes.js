"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
// ─── Helper: generate 6-digit OTP ────────────────────────────────────────────
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}
// ─── Helper: baca Discord config saat request (BUKAN saat module load) ────────
function getDiscordConfig() {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const redirectUri = `${process.env.BASE_URL}/verify/discord/callback`;
    if (!clientId || !clientSecret) {
        throw new Error('DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET not set in .env');
    }
    return { clientId, clientSecret, redirectUri };
}
// ─── GET /dashboard ───────────────────────────────────────────────────────────
// Status verifikasi + data karakter selalu dibaca dari DB agar tidak reset
// saat server restart
router.get('/dashboard', async (req, res) => {
    const session = req.session;
    if (!session?.user)
        return res.redirect('/login');
    try {
        // Ambil status verifikasi + role terbaru dari DB
        const [accRows] = await database_1.pool.execute(`SELECT EmailVerified, DiscordVerified, DiscordUsername, DiscordAvatar, Admin, Banned, Password, Salt
             FROM accounts
             WHERE ID = ?`, [session.user.id]);
        if (!accRows.length)
            return res.redirect('/login');
        const ROLE_MAP = {
            0: 'Citizen',
            1: 'Helper',
            2: 'Administrator',
            3: 'Head Administrator',
            4: 'Management',
            5: 'General Manager',
            6: 'Executive',
            7: 'Developer',
        };
        const adminLevel = Number(accRows[0].Admin ?? 0);
        const accountRole = ROLE_MAP[adminLevel] ?? 'Citizen';
        // Ambil semua karakter milik user ini berdasarkan Username
        const [characters] = await database_1.pool.execute(`SELECT id, \`Character\`, \`Origin\`, \`Gender\`, \`Birthdate\`, \`Money\`, \`Gold\`, \`Skin\`, \`Story\`, \`Health\`, \`ArmorStatus\`
             FROM characters
             WHERE Username = ?`, [session.user.username]);
        // Normalisasi data karakter
        const characterList = characters.map((c) => ({
            id: c.id,
            name: c.Character,
            origin: c.Origin,
            gender: c.Gender === 1 ? 'Male' : 'Female',
            birthdate: c.Birthdate,
            money: Number(c.Money).toLocaleString('id-ID'),
            gold: Number(c.Gold).toLocaleString('id-ID'),
            story: c.Story === 1 ? 'Active' : 'Inactive',
            health: Math.round(Number(c.Health)),
            armor: Math.round(Number(c.ArmorStatus)),
            skin: c.Skin,
            skinUrl: `https://assets.open.mp/assets/images/skins/${c.Skin}.png`,
        }));
        const user = {
            ...session.user,
            emailVerified: accRows[0].EmailVerified === 1,
            discordVerified: accRows[0].DiscordVerified === 1,
            discordUsername: accRows[0].DiscordUsername || null,
            discordAvatar: accRows[0].DiscordAvatar || null,
            accountRole,
            adminLevel,
        };
        res.render('dashboard', { user, characters: characterList });
    }
    catch (err) {
        console.error('[GET /dashboard]', err);
        res.status(500).send('Server error');
    }
});
// ─── POST /verify/email/send ──────────────────────────────────────────────────
router.post('/verify/email/send', async (req, res) => {
    try {
        const session = req.session;
        if (!session?.user)
            return res.status(401).json({ error: 'Not logged in' });
        const userId = session.user.id;
        const userEmail = session.user.email;
        const [check] = await database_1.pool.execute('SELECT EmailVerified FROM accounts WHERE ID = ?', [userId]);
        if (check.length && check[0].EmailVerified === 1) {
            return res.status(400).json({ error: 'Email already verified' });
        }
        const otp = generateOTP();
        const expiry = new Date(Date.now() + 10 * 60 * 1000);
        await database_1.pool.execute('UPDATE accounts SET EmailOTP = ?, EmailOTPExpiry = ? WHERE ID = ?', [otp, expiry, userId]);
        await transporter.sendMail({
            from: `"CENTRA ROLEPLAY" <${process.env.EMAIL_USER}>`,
            to: userEmail,
            subject: 'Email Verification Code – CENTRA ROLEPLAY',
            html: `
                <div style="font-family:Inter,Arial,sans-serif;max-width:500px;margin:0 auto;
                            padding:2rem;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
                    <h2 style="margin:0 0 1rem;color:#111827;">CENTRA ROLEPLAY</h2>
                    <p style="color:#6b7280;">Your email verification code is:</p>
                    <div style="font-size:2.5rem;font-weight:700;letter-spacing:8px;color:#000;
                                background:#f9fafb;padding:1rem;border-radius:8px;
                                text-align:center;margin:1.5rem 0;">
                        ${otp}
                    </div>
                    <p style="color:#6b7280;font-size:0.875rem;">
                        This code expires in <strong>10 minutes</strong>.
                        Do not share it with anyone.
                    </p>
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
// ─── POST /verify/email/confirm ───────────────────────────────────────────────
router.post('/verify/email/confirm', async (req, res) => {
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
            return res.status(400).json({ error: 'No OTP requested. Click "Send OTP" first.' });
        if (new Date() > new Date(EmailOTPExpiry))
            return res.status(400).json({ error: 'OTP has expired. Please request a new code.' });
        if (otp.trim() !== EmailOTP)
            return res.status(400).json({ error: 'Invalid OTP. Check your email.' });
        await database_1.pool.execute('UPDATE accounts SET EmailVerified = 1, EmailOTP = NULL, EmailOTPExpiry = NULL WHERE ID = ?', [userId]);
        session.user.emailVerified = true;
        res.json({ success: true });
    }
    catch (err) {
        console.error('[verify/email/confirm]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ─── GET /verify/discord ──────────────────────────────────────────────────────
router.get('/verify/discord', (req, res) => {
    const session = req.session;
    if (!session?.user)
        return res.redirect('/login');
    try {
        const { clientId, redirectUri } = getDiscordConfig();
        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'identify',
        });
        res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
    }
    catch (err) {
        console.error('[verify/discord]', err);
        res.redirect('/settings?discord=error');
    }
});
// ─── GET /verify/discord/callback ────────────────────────────────────────────
router.get('/verify/discord/callback', async (req, res) => {
    try {
        const session = req.session;
        if (!session?.user)
            return res.redirect('/login');
        const { code, error } = req.query;
        if (error || !code)
            return res.redirect('/settings?discord=error');
        const { clientId, clientSecret, redirectUri } = getDiscordConfig();
        const tokenRes = await axios_1.default.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: redirectUri,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const { access_token } = tokenRes.data;
        const userRes = await axios_1.default.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` },
        });
        const { id: discordId, username: discordUsername, avatar } = userRes.data;
        const discordAvatar = avatar
            ? `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png`
            : null;
        const userId = session.user.id;
        const [existing] = await database_1.pool.execute('SELECT ID FROM accounts WHERE DiscordID = ? AND ID != ?', [discordId, userId]);
        if (existing.length > 0) {
            return res.redirect('/settings?discord=taken');
        }
        await database_1.pool.execute(`UPDATE accounts
             SET DiscordVerified = 1, DiscordID = ?, DiscordUsername = ?, DiscordAvatar = ?
             WHERE ID = ?`, [discordId, discordUsername, discordAvatar, userId]);
        session.user.discordVerified = true;
        session.user.discordUsername = discordUsername;
        res.redirect('/settings?discord=success');
    }
    catch (err) {
        console.error('[verify/discord/callback]', err?.response?.data || err);
        res.redirect('/settings?discord=error');
    }
});
// ─── GET /settings ───────────────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
    const session = req.session;
    if (!session?.user)
        return res.redirect('/login');
    try {
        const [accRows] = await database_1.pool.execute(`SELECT EmailVerified, DiscordVerified, DiscordUsername, DiscordAvatar, Admin, Banned, Password, Salt
             FROM accounts
             WHERE ID = ?`, [session.user.id]);
        if (!accRows.length)
            return res.redirect('/login');
        const ROLE_MAP = {
            0: 'Citizen', 1: 'Helper', 2: 'Administrator',
            3: 'Head Administrator', 4: 'Management',
            5: 'General Manager', 6: 'Executive', 7: 'Developer',
        };
        const adminLevel = Number(accRows[0].Admin ?? 0);
        const accountRole = ROLE_MAP[adminLevel] ?? 'Citizen';
        const user = {
            ...session.user,
            emailVerified: accRows[0].EmailVerified === 1,
            discordVerified: accRows[0].DiscordVerified === 1,
            discordUsername: accRows[0].DiscordUsername || null,
            discordAvatar: accRows[0].DiscordAvatar || null,
            accountRole,
            adminLevel,
            banned: accRows[0].Banned === 1,
            passwordHash: accRows[0].Password,
            salt: accRows[0].Salt,
        };
        // Fetch login history (last 10 entries)
        const [historyRows] = await database_1.pool.execute(`SELECT IPAddress, LoginTime
             FROM login_history
             WHERE AccountID = ?
             ORDER BY LoginTime DESC
             LIMIT 50`, [session.user.id]);
        // Fetch geo for each unique IP — fallback to null (shown as Unknown in template)
        const loginHistory = await Promise.all(historyRows.map(async (row) => {
            const ip = row.IPAddress || '—';
            const time = row.LoginTime || new Date();
            try {
                const geo = await axios_1.default.get(`http://ip-api.com/json/${ip}?fields=country,regionName,city,status`, { timeout: 3000 });
                const d = geo.data;
                const loc = (d.status === 'success' && d.city)
                    ? `${d.city}, ${d.regionName}, ${d.country}`
                    : null;
                return { ip, time, location: loc };
            }
            catch {
                return { ip, time, location: null };
            }
        }));
        res.render('settings', { user, loginHistory });
    }
    catch (err) {
        console.error('[GET /settings]', err);
        res.status(500).send('Server error');
    }
});
// ─── POST /settings/change-password ──────────────────────────────────────────
router.post('/settings/change-password', async (req, res) => {
    try {
        const session = req.session;
        if (!session?.user)
            return res.status(401).json({ error: 'Not logged in' });
        const { currentPassword, newPassword, confirmPassword } = req.body;
        if (!currentPassword || !newPassword || !confirmPassword)
            return res.status(400).json({ error: 'All fields are required' });
        if (newPassword !== confirmPassword)
            return res.status(400).json({ error: 'New passwords do not match' });
        if (newPassword.length < 6)
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        const userId = session.user.id;
        const [rows] = await database_1.pool.execute('SELECT Password, Salt FROM accounts WHERE ID = ?', [userId]);
        if (!rows.length)
            return res.status(404).json({ error: 'User not found' });
        const { createHash } = await Promise.resolve().then(() => __importStar(require('crypto')));
        function hashPassword(password, salt) {
            return createHash('sha256')
                .update(password + salt, 'utf8')
                .digest('hex')
                .toUpperCase();
        }
        function generateSalt(length = 64) {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
                '!@#$%^&*()-_=+[]{}<>?/\\|`~:;"\',. ';
            let salt = '';
            for (let i = 0; i < length; i++) {
                salt += chars[Math.floor(Math.random() * chars.length)];
            }
            return salt;
        }
        // Verify current password
        const currentHash = hashPassword(currentPassword, rows[0].Salt);
        if (currentHash !== rows[0].Password)
            return res.status(400).json({ error: 'Current password is incorrect' });
        // Generate new salt + hash
        const newSalt = generateSalt();
        const newHash = hashPassword(newPassword, newSalt);
        await database_1.pool.execute('UPDATE accounts SET Password = ?, Salt = ? WHERE ID = ?', [newHash, newSalt, userId]);
        res.json({ success: true });
    }
    catch (err) {
        console.error('[settings/change-password]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ─── GET /leaderboard ─────────────────────────────────────────────────────────
router.get('/leaderboard', async (req, res) => {
    const session = req.session;
    if (!session?.user)
        return res.redirect('/login');
    try {
        const [topMoney] = await database_1.pool.execute(`SELECT \`Character\`, Username, Money, Skin
             FROM characters
             ORDER BY Money DESC
             LIMIT 10`);
        const [topGold] = await database_1.pool.execute(`SELECT \`Character\`, Username, Gold, Skin
             FROM characters
             ORDER BY Gold DESC
             LIMIT 10`);
        // Ambil discordAvatar terbaru dari DB untuk navbar
        const [lbAcc] = await database_1.pool.execute('SELECT DiscordAvatar FROM accounts WHERE ID = ?', [session.user.id]);
        const lbUser = {
            ...session.user,
            discordAvatar: lbAcc.length ? (lbAcc[0].DiscordAvatar || null) : null,
        };
        res.render('leaderboard', {
            user: lbUser,
            topMoney,
            topGold,
        });
    }
    catch (err) {
        console.error('[GET /leaderboard]', err);
        res.status(500).send('Server error');
    }
});
exports.default = router;
