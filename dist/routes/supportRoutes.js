"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = require("../database");
const router = (0, express_1.Router)();
// ─── Helper: check if user is admin (Admin >= 2) ──────────────────────────────
async function isAdmin(userId) {
    const [rows] = await database_1.pool.execute('SELECT Admin FROM accounts WHERE ID = ?', [userId]);
    return rows.length > 0 && Number(rows[0].Admin) >= 2;
}
// ─── Auto-close tickets idle for 3 days (called on page load) ────────────────
async function autoCloseIdleTickets() {
    await database_1.pool.execute(`UPDATE support_tickets
         SET status = 'closed', closed_at = NOW()
         WHERE status != 'closed'
           AND updated_at < DATE_SUB(NOW(), INTERVAL 3 DAY)`);
}
// ─── GET /support ─────────────────────────────────────────────────────────────
// List tickets for the current user (or all tickets if admin)
router.get('/support', async (req, res) => {
    const session = req.session;
    if (!session?.user)
        return res.redirect('/login');
    try {
        await autoCloseIdleTickets();
        const userId = session.user.id;
        const adminUser = await isAdmin(userId);
        // Fetch account data for navbar
        const [accRows] = await database_1.pool.execute('SELECT DiscordAvatar FROM accounts WHERE ID = ?', [userId]);
        const user = {
            ...session.user,
            discordAvatar: accRows.length ? (accRows[0].DiscordAvatar || null) : null,
            isAdmin: adminUser,
        };
        let tickets;
        if (adminUser) {
            // Admins see all non-closed tickets + recently closed
            const [rows] = await database_1.pool.execute(`SELECT t.*, 
                        (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id) AS message_count
                 FROM support_tickets t
                 ORDER BY FIELD(t.status,'open','in_progress','closed'), t.updated_at DESC
                 LIMIT 100`);
            tickets = rows;
        }
        else {
            // Users see only their own tickets
            const [rows] = await database_1.pool.execute(`SELECT t.*,
                        (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id) AS message_count
                 FROM support_tickets t
                 WHERE t.account_id = ?
                 ORDER BY t.updated_at DESC`, [userId]);
            tickets = rows;
        }
        res.render('support', { user, tickets });
    }
    catch (err) {
        console.error('[GET /support]', err);
        res.status(500).send('Server error');
    }
});
// ─── POST /support/create ─────────────────────────────────────────────────────
router.post('/support/create', async (req, res) => {
    try {
        const session = req.session;
        if (!session?.user)
            return res.status(401).json({ error: 'Not logged in' });
        const { subject, message } = req.body;
        if (!subject?.trim() || !message?.trim())
            return res.status(400).json({ error: 'Subject and message are required' });
        if (subject.trim().length > 255)
            return res.status(400).json({ error: 'Subject too long (max 255 chars)' });
        const userId = session.user.id;
        const username = session.user.username;
        // Prevent duplicate open tickets from same user
        const [existing] = await database_1.pool.execute(`SELECT id FROM support_tickets WHERE account_id = ? AND status != 'closed' LIMIT 1`, [userId]);
        if (existing.length > 0)
            return res.status(400).json({ error: 'You already have an open ticket. Please wait for it to be resolved before creating a new one.' });
        // Create ticket
        const [result] = await database_1.pool.execute(`INSERT INTO support_tickets (account_id, username, subject) VALUES (?, ?, ?)`, [userId, username, subject.trim()]);
        const ticketId = result.insertId;
        // Add first message
        await database_1.pool.execute(`INSERT INTO support_messages (ticket_id, sender_id, sender_name, is_admin, message)
             VALUES (?, ?, ?, 0, ?)`, [ticketId, userId, username, message.trim()]);
        res.json({ success: true, ticketId });
    }
    catch (err) {
        console.error('[POST /support/create]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ─── GET /support/:id ─────────────────────────────────────────────────────────
router.get('/support/:id', async (req, res) => {
    try {
        const session = req.session;
        if (!session?.user)
            return res.redirect('/login');
        await autoCloseIdleTickets();
        const ticketId = parseInt(req.params.id);
        if (isNaN(ticketId))
            return res.redirect('/support');
        const userId = session.user.id;
        const adminUser = await isAdmin(userId);
        // Fetch ticket
        const [ticketRows] = await database_1.pool.execute('SELECT * FROM support_tickets WHERE id = ?', [ticketId]);
        if (!ticketRows.length)
            return res.redirect('/support');
        const ticket = ticketRows[0];
        // Access control: user can only view their own ticket
        if (!adminUser && ticket.account_id !== userId)
            return res.redirect('/support');
        // Mark as in_progress when admin opens it
        if (adminUser && ticket.status === 'open') {
            await database_1.pool.execute(`UPDATE support_tickets SET status = 'in_progress' WHERE id = ?`, [ticketId]);
            ticket.status = 'in_progress';
        }
        // Fetch messages
        const [messages] = await database_1.pool.execute(`SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY sent_at ASC`, [ticketId]);
        // Fetch account data for navbar
        const [accRows] = await database_1.pool.execute('SELECT DiscordAvatar FROM accounts WHERE ID = ?', [userId]);
        const user = {
            ...session.user,
            discordAvatar: accRows.length ? (accRows[0].DiscordAvatar || null) : null,
            isAdmin: adminUser,
        };
        res.render('support-chat', { user, ticket, messages });
    }
    catch (err) {
        console.error('[GET /support/:id]', err);
        res.status(500).send('Server error');
    }
});
// ─── POST /support/:id/reply ──────────────────────────────────────────────────
router.post('/support/:id/reply', async (req, res) => {
    try {
        const session = req.session;
        if (!session?.user)
            return res.status(401).json({ error: 'Not logged in' });
        const ticketId = parseInt(req.params.id);
        if (isNaN(ticketId))
            return res.status(400).json({ error: 'Invalid ticket' });
        const { message } = req.body;
        if (!message?.trim())
            return res.status(400).json({ error: 'Message cannot be empty' });
        const userId = session.user.id;
        const username = session.user.username;
        const adminUser = await isAdmin(userId);
        // Fetch ticket
        const [ticketRows] = await database_1.pool.execute('SELECT * FROM support_tickets WHERE id = ?', [ticketId]);
        if (!ticketRows.length)
            return res.status(404).json({ error: 'Ticket not found' });
        const ticket = ticketRows[0];
        if (ticket.status === 'closed')
            return res.status(400).json({ error: 'This ticket is closed and cannot receive new messages.' });
        if (!adminUser && ticket.account_id !== userId)
            return res.status(403).json({ error: 'Access denied' });
        await database_1.pool.execute(`INSERT INTO support_messages (ticket_id, sender_id, sender_name, is_admin, message)
             VALUES (?, ?, ?, ?, ?)`, [ticketId, userId, username, adminUser ? 1 : 0, message.trim()]);
        // Keep ticket updated_at fresh (auto-updated by MySQL)
        await database_1.pool.execute(`UPDATE support_tickets SET updated_at = NOW() WHERE id = ?`, [ticketId]);
        res.json({ success: true });
    }
    catch (err) {
        console.error('[POST /support/:id/reply]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ─── POST /support/:id/close ──────────────────────────────────────────────────
router.post('/support/:id/close', async (req, res) => {
    try {
        const session = req.session;
        if (!session?.user)
            return res.status(401).json({ error: 'Not logged in' });
        const ticketId = parseInt(req.params.id);
        const userId = session.user.id;
        const adminUser = await isAdmin(userId);
        const [ticketRows] = await database_1.pool.execute('SELECT * FROM support_tickets WHERE id = ?', [ticketId]);
        if (!ticketRows.length)
            return res.status(404).json({ error: 'Ticket not found' });
        const ticket = ticketRows[0];
        if (!adminUser && ticket.account_id !== userId)
            return res.status(403).json({ error: 'Access denied' });
        await database_1.pool.execute(`UPDATE support_tickets SET status = 'closed', closed_at = NOW() WHERE id = ?`, [ticketId]);
        res.json({ success: true });
    }
    catch (err) {
        console.error('[POST /support/:id/close]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
