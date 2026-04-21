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
// Status verifikasi + data karakter selalu dibaca dari DB agar tidak reset
// saat server restart
router.get('/dashboard', async (req: Request, res: Response) => {
    const session = req.session as any;
    if (!session?.user) return res.redirect('/login');

    try {
        // Ambil status verifikasi + role terbaru dari DB
        const [accRows]: any = await pool.execute(
            `SELECT EmailVerified, DiscordVerified, DiscordUsername, DiscordAvatar, Admin, Banned, Password, Salt
             FROM accounts
             WHERE ID = ?`,
            [session.user.id]
        );

        if (!accRows.length) return res.redirect('/login');

        const ROLE_MAP: Record<number, string> = {
            0: 'Citizen',
            1: 'Volunter',
            2: 'Helper',
            3: 'Administrator',
            4: 'Head Administrator',
            5: 'Management',
            6: 'General Manager',
            7: 'Executive',
            8: 'Developer',
        };
        const adminLevel  = Number(accRows[0].Admin ?? 0);
        const accountRole = ROLE_MAP[adminLevel] ?? 'Citizen';

        // Ambil semua karakter milik user ini berdasarkan Username
        const [characters]: any = await pool.execute(
            `SELECT id, \`Character\`, \`Origin\`, \`Gender\`, \`Birthdate\`, \`Money\`, \`Gold\`, \`Skin\`, \`Story\`, \`Health\`, \`ArmorStatus\`
             FROM characters
             WHERE Username = ?`,
            [session.user.username]
        );

        // Normalisasi data karakter
        const characterList = characters.map((c: any) => ({
            id:        c.id,
            name:      c.Character,
            origin:    c.Origin,
            gender:    c.Gender === 1 ? 'Male' : 'Female',
            birthdate: c.Birthdate,
            money:     Number(c.Money).toLocaleString('id-ID'),
            gold:      Number(c.Gold).toLocaleString('id-ID'),
            story:     c.Story === 1 ? 'Active' : 'Inactive',
            health:    Math.round(Number(c.Health)),
            armor:     Math.round(Number(c.ArmorStatus)),
            skin:      c.Skin,
            skinUrl:   `https://assets.open.mp/assets/images/skins/${c.Skin}.png`,
        }));

        const user = {
            ...session.user,
            emailVerified:   accRows[0].EmailVerified  === 1,
            discordVerified: accRows[0].DiscordVerified === 1,
            discordUsername: accRows[0].DiscordUsername || null,
            discordAvatar:   accRows[0].DiscordAvatar   || null,
            accountRole,
            adminLevel,
        };

        res.render('dashboard', { user, characters: characterList });
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

        const [check]: any = await pool.execute(
            'SELECT EmailVerified FROM accounts WHERE ID = ?',
            [userId]
        );
        if (check.length && check[0].EmailVerified === 1) {
            return res.status(400).json({ error: 'Email already verified' });
        }

        const otp    = generateOTP();
        const expiry = new Date(Date.now() + 10 * 60 * 1000);

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

        await pool.execute(
            'UPDATE accounts SET EmailVerified = 1, EmailOTP = NULL, EmailOTPExpiry = NULL WHERE ID = ?',
            [userId]
        );

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
        res.redirect('/settings?discord=error');
    }
});

// ─── GET /verify/discord/callback ────────────────────────────────────────────
router.get('/verify/discord/callback', async (req: Request, res: Response) => {
    try {
        const session = req.session as any;
        if (!session?.user) return res.redirect('/login');

        const { code, error } = req.query;
        if (error || !code) return res.redirect('/settings?discord=error');

        const { clientId, clientSecret, redirectUri } = getDiscordConfig();

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

        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` },
        });

        const { id: discordId, username: discordUsername, avatar } = userRes.data;
        const discordAvatar = avatar
            ? `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png`
            : null;

        const userId = session.user.id;

        const [existing]: any = await pool.execute(
            'SELECT ID FROM accounts WHERE DiscordID = ? AND ID != ?',
            [discordId, userId]
        );
        if (existing.length > 0) {
            return res.redirect('/settings?discord=taken');
        }

        await pool.execute(
            `UPDATE accounts
             SET DiscordVerified = 1, DiscordID = ?, DiscordUsername = ?, DiscordAvatar = ?
             WHERE ID = ?`,
            [discordId, discordUsername, discordAvatar, userId]
        );

        session.user.discordVerified = true;
        session.user.discordUsername = discordUsername;

        res.redirect('/settings?discord=success');
    } catch (err: any) {
        console.error('[verify/discord/callback]', err?.response?.data || err);
        res.redirect('/settings?discord=error');
    }
});

// ─── GET /settings ───────────────────────────────────────────────────────────
router.get('/settings', async (req: Request, res: Response) => {
    const session = req.session as any;
    if (!session?.user) return res.redirect('/login');

    try {
        const [accRows]: any = await pool.execute(
            `SELECT EmailVerified, DiscordVerified, DiscordUsername, DiscordAvatar, Admin, Banned, Password, Salt
             FROM accounts
             WHERE ID = ?`,
            [session.user.id]
        );

        if (!accRows.length) return res.redirect('/login');

        const ROLE_MAP: Record<number, string> = {
            0: 'Citizen', 1: 'Volunter', 2: 'Helper', 3: 'Administrator',
            4: 'Head Administrator', 5: 'Management',
            6: 'General Manager', 7: 'Executive', 8: 'Developer',
        };
        const adminLevel  = Number(accRows[0].Admin ?? 0);
        const accountRole = ROLE_MAP[adminLevel] ?? 'Citizen';

        const user = {
            ...session.user,
            emailVerified:   accRows[0].EmailVerified  === 1,
            discordVerified: accRows[0].DiscordVerified === 1,
            discordUsername: accRows[0].DiscordUsername || null,
            discordAvatar:   accRows[0].DiscordAvatar   || null,
            accountRole,
            adminLevel,
            banned:          accRows[0].Banned === 1,
            passwordHash:    accRows[0].Password,
            salt:            accRows[0].Salt,
        };

        // Fetch login history (last 10 entries)
        const [historyRows]: any = await pool.execute(
            `SELECT IPAddress, LoginTime
             FROM login_history
             WHERE AccountID = ?
             ORDER BY LoginTime DESC
             LIMIT 50`,
            [session.user.id]
        );

        // Fetch geo for each unique IP — fallback to null (shown as Unknown in template)
        const loginHistory = await Promise.all(
            historyRows.map(async (row: any) => {
                const ip   = row.IPAddress || '—';
                const time = row.LoginTime || new Date();
                try {
                    const geo = await axios.get(
                        `http://ip-api.com/json/${ip}?fields=country,regionName,city,status`,
                        { timeout: 3000 }
                    );
                    const d   = geo.data;
                    const loc = (d.status === 'success' && d.city)
                        ? `${d.city}, ${d.regionName}, ${d.country}`
                        : null;
                    return { ip, time, location: loc };
                } catch {
                    return { ip, time, location: null };
                }
            })
        );

        res.render('settings', { user, loginHistory });
    } catch (err) {
        console.error('[GET /settings]', err);
        res.status(500).send('Server error');
    }
});

// ─── POST /settings/change-password ──────────────────────────────────────────
router.post('/settings/change-password', async (req: Request, res: Response) => {
    try {
        const session = req.session as any;
        if (!session?.user) return res.status(401).json({ error: 'Not logged in' });

        const { currentPassword, newPassword, confirmPassword } = req.body;

        if (!currentPassword || !newPassword || !confirmPassword)
            return res.status(400).json({ error: 'All fields are required' });

        if (newPassword !== confirmPassword)
            return res.status(400).json({ error: 'New passwords do not match' });

        if (newPassword.length < 6)
            return res.status(400).json({ error: 'New password must be at least 6 characters' });

        const userId = session.user.id;

        const [rows]: any = await pool.execute(
            'SELECT Password, Salt FROM accounts WHERE ID = ?',
            [userId]
        );
        if (!rows.length) return res.status(404).json({ error: 'User not found' });

        const { createHash } = await import('crypto');

        function hashPassword(password: string, salt: string): string {
            return createHash('sha256')
                .update(password + salt, 'utf8')
                .digest('hex')
                .toUpperCase();
        }

        function generateSalt(length = 64): string {
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

        await pool.execute(
            'UPDATE accounts SET Password = ?, Salt = ? WHERE ID = ?',
            [newHash, newSalt, userId]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('[settings/change-password]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// ─── GET /leaderboard ─────────────────────────────────────────────────────────
router.get('/leaderboard', async (req: Request, res: Response) => {
    const session = req.session as any;
    if (!session?.user) return res.redirect('/login');

    try {
        const [topMoney]: any = await pool.execute(
            `SELECT \`Character\`, Username, Money, Skin
             FROM characters
             ORDER BY Money DESC
             LIMIT 10`
        );

        const [topGold]: any = await pool.execute(
            `SELECT \`Character\`, Username, Gold, Skin
             FROM characters
             ORDER BY Gold DESC
             LIMIT 10`
        );

        // Ambil discordAvatar terbaru dari DB untuk navbar
        const [lbAcc]: any = await pool.execute(
            'SELECT DiscordAvatar FROM accounts WHERE ID = ?',
            [session.user.id]
        );
        const lbUser = {
            ...session.user,
            discordAvatar: lbAcc.length ? (lbAcc[0].DiscordAvatar || null) : null,
        };

        res.render('leaderboard', {
            user: lbUser,
            topMoney,
            topGold,
        });
    } catch (err) {
        console.error('[GET /leaderboard]', err);
        res.status(500).send('Server error');
    }
});


// ─── POST /settings/delete-account ───────────────────────────────────────────
router.post('/settings/delete-account', async (req: Request, res: Response) => {
    try {
        const session = req.session as any;
        if (!session?.user) return res.status(401).json({ error: 'Not logged in' });

        const userId   = session.user.id;
        const username = session.user.username;

        // Delete characters first (FK safety)
        await pool.execute('DELETE FROM characters WHERE Username = ?', [username]);

        // Delete the account
        await pool.execute('DELETE FROM accounts WHERE ID = ?', [userId]);

        // Destroy session
        session.destroy(() => {});

        res.json({ success: true });
    } catch (err) {
        console.error('[settings/delete-account]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;