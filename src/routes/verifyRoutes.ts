import { Router, Request, Response } from 'express';
import { pool } from '../database';
import nodemailer from 'nodemailer';
import axios from 'axios';

const router = Router();

// ─── Email Transporter ────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD,
    },
});

// ─── Helper: generate 6-digit OTP ────────────────────────────────────────────
function generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─── Helper: baca Discord config saat request (BUKAN saat module load) ────────
function getDiscordConfig() {
    const clientId     = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const redirectUri  = `${process.env.BASE_URL}/verify/discord/callback`;

    if (!clientId || !clientSecret) {
        throw new Error('DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET not set in .env');
    }
    return { clientId, clientSecret, redirectUri };
}

// ─── GET /dashboard ───────────────────────────────────────────────────────────
// Status emailVerified & discordVerified selalu dibaca dari DB (bukan session)
// agar tidak reset saat server restart
router.get('/dashboard', async (req: Request, res: Response) => {
    const session = req.session as any;
    if (!session?.user) return res.redirect('/login');

    try {
        const [rows]: any = await pool.execute(
            `SELECT EmailVerified, DiscordVerified, DiscordUsername
             FROM accounts
             WHERE ID = ?`,
            [session.user.id]
        );

        if (!rows.length) return res.redirect('/login');

        const user = {
            ...session.user,
            emailVerified:   rows[0].EmailVerified  === 1,
            discordVerified: rows[0].DiscordVerified === 1,
            discordUsername: rows[0].DiscordUsername || null,
        };

        res.render('dashboard', { user });
    } catch (err) {
        console.error('[GET /dashboard]', err);
        res.status(500).send('Server error');
    }
});

// ─── POST /verify/email/send ──────────────────────────────────────────────────
router.post('/verify/email/send', async (req: Request, res: Response) => {
    try {
        const session = req.session as any;
        if (!session?.user) return res.status(401).json({ error: 'Not logged in' });

        const userId    = session.user.id;
        const userEmail = session.user.email;

        // Cek DB langsung agar tidak bypass saat session lama
        const [check]: any = await pool.execute(
            'SELECT EmailVerified FROM accounts WHERE ID = ?',
            [userId]
        );
        if (check.length && check[0].EmailVerified === 1) {
            return res.status(400).json({ error: 'Email already verified' });
        }

        const otp    = generateOTP();
        const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 menit

        await pool.execute(
            'UPDATE accounts SET EmailOTP = ?, EmailOTPExpiry = ? WHERE ID = ?',
            [otp, expiry, userId]
        );

        await transporter.sendMail({
            from:    `"CENTRA ROLEPLAY" <${process.env.EMAIL_USER}>`,
            to:      userEmail,
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
    } catch (err) {
        console.error('[verify/email/send]', err);
        res.status(500).json({ error: 'Failed to send OTP' });
    }
});

// ─── POST /verify/email/confirm ───────────────────────────────────────────────
router.post('/verify/email/confirm', async (req: Request, res: Response) => {
    try {
        const session = req.session as any;
        if (!session?.user) return res.status(401).json({ error: 'Not logged in' });

        const { otp } = req.body;
        if (!otp) return res.status(400).json({ error: 'OTP is required' });

        const userId = session.user.id;

        const [rows]: any = await pool.execute(
            'SELECT EmailOTP, EmailOTPExpiry FROM accounts WHERE ID = ?',
            [userId]
        );

        if (!rows.length) return res.status(404).json({ error: 'User not found' });

        const { EmailOTP, EmailOTPExpiry } = rows[0];

        if (!EmailOTP || !EmailOTPExpiry)
            return res.status(400).json({ error: 'No OTP requested. Click "Send OTP" first.' });

        if (new Date() > new Date(EmailOTPExpiry))
            return res.status(400).json({ error: 'OTP has expired. Please request a new code.' });

        if (otp.trim() !== EmailOTP)
            return res.status(400).json({ error: 'Invalid OTP. Check your email.' });

        // Simpan ke DB, hapus OTP
        await pool.execute(
            'UPDATE accounts SET EmailVerified = 1, EmailOTP = NULL, EmailOTPExpiry = NULL WHERE ID = ?',
            [userId]
        );

        // Sync session supaya tidak perlu reload dua kali
        session.user.emailVerified = true;

        res.json({ success: true });
    } catch (err) {
        console.error('[verify/email/confirm]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── GET /verify/discord ──────────────────────────────────────────────────────
router.get('/verify/discord', (req: Request, res: Response) => {
    const session = req.session as any;
    if (!session?.user) return res.redirect('/login');

    try {
        const { clientId, redirectUri } = getDiscordConfig();

        const params = new URLSearchParams({
            client_id:     clientId,
            redirect_uri:  redirectUri,
            response_type: 'code',
            scope:         'identify',
        });

        res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
    } catch (err) {
        console.error('[verify/discord]', err);
        res.redirect('/dashboard?discord=error');
    }
});

// ─── GET /verify/discord/callback ────────────────────────────────────────────
router.get('/verify/discord/callback', async (req: Request, res: Response) => {
    try {
        const session = req.session as any;
        if (!session?.user) return res.redirect('/login');

        const { code, error } = req.query;
        if (error || !code) return res.redirect('/dashboard?discord=error');

        const { clientId, clientSecret, redirectUri } = getDiscordConfig();

        // Tukar code dengan access token
        const tokenRes = await axios.post(
            'https://discord.com/api/oauth2/token',
            new URLSearchParams({
                client_id:     clientId,
                client_secret: clientSecret,
                grant_type:    'authorization_code',
                code:          code as string,
                redirect_uri:  redirectUri,
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token } = tokenRes.data;

        // Ambil info user Discord
        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` },
        });

        const { id: discordId, username: discordUsername, avatar } = userRes.data;
        const discordAvatar = avatar
            ? `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png`
            : null;

        const userId = session.user.id;

        // Cek apakah Discord ID sudah dipakai akun lain
        const [existing]: any = await pool.execute(
            'SELECT ID FROM accounts WHERE DiscordID = ? AND ID != ?',
            [discordId, userId]
        );
        if (existing.length > 0) {
            return res.redirect('/dashboard?discord=taken');
        }

        // Simpan ke DB
        await pool.execute(
            `UPDATE accounts
             SET DiscordVerified = 1, DiscordID = ?, DiscordUsername = ?, DiscordAvatar = ?
             WHERE ID = ?`,
            [discordId, discordUsername, discordAvatar, userId]
        );

        // Sync session
        session.user.discordVerified = true;
        session.user.discordUsername = discordUsername;

        res.redirect('/dashboard?discord=success');
    } catch (err: any) {
        console.error('[verify/discord/callback]', err?.response?.data || err);
        res.redirect('/dashboard?discord=error');
    }
});

export default router;