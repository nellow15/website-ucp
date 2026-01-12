import { Router, Request, Response } from 'express';
import { pool } from '../database';

const router = Router();

// API to check username availability
router.get('/check-username/:username', async (req: Request, res: Response) => {
    try {
        const [rows]: any = await pool.execute(
            'SELECT Username FROM accounts WHERE Username = ?',
            [req.params.username]
        );
        
        res.json({ available: rows.length === 0 });
    } catch (error) {
        console.error('API error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API to check email availability
router.get('/check-email/:email', async (req: Request, res: Response) => {
    try {
        const [rows]: any = await pool.execute(
            'SELECT Email FROM accounts WHERE Email = ?',
            [req.params.email]
        );
        
        res.json({ available: rows.length === 0 });
    } catch (error) {
        console.error('API error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API to get user stats
router.get('/user-stats/:username', async (req: Request, res: Response) => {
    try {
        const [rows]: any = await pool.execute(
            'SELECT Username, Email, PhoneNumber, CreatedAt, LastLogin FROM accounts WHERE Username = ?',
            [req.params.username]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        console.error('API error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API untuk verify login (backward compatibility)
router.post('/verify-login', async (req: Request, res: Response) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        
        const [rows]: any = await pool.execute(
            'SELECT * FROM accounts WHERE Username = ?',
            [username]
        );
        
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
    } catch (error) {
        console.error('API error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;