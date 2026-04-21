import express from 'express';
import path from 'path';
import session from 'express-session';
import flash from 'connect-flash';
import { config } from 'dotenv';
import authRoutes from './routes/auth';
import apiRoutes from './routes/api';
import verifyRoutes from './routes/verifyRoutes';
import supportRoutes from './routes/supportRoutes';
import { connectDB } from './database';

// Load environment variables
config();

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to database
connectDB();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'samp_ucp_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

app.use(flash());

// Make flash messages available in all views
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.error = req.flash('error');
    res.locals.user = (req.session as any).user || null;
    next();
});

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes
app.use('/', authRoutes);
app.use('/api', apiRoutes);
app.use('/', verifyRoutes);
app.use('/', supportRoutes);

// Home route
app.get('/', (req, res) => {
    res.render('index', { 
        title: 'SA:MP UCP Panel',
        user: (req.session as any).user 
    });
});

// Dashboard route (protected)
app.get('/dashboard', (req, res) => {
    if (!(req.session as any).user) {
        req.flash('error_msg', 'Please login to access dashboard');
        return res.redirect('/login');
    }
    res.render('dashboard', { 
        title: 'Dashboard',
        user: (req.session as any).user 
    });
});

// Login Code Page redirect (tidak digunakan lagi)
app.get('/login-code', (req, res) => {
    req.flash('error_msg', 'Login code system is no longer available');
    res.redirect('/login');
});

// Register redirect (karena register dihapus)
app.get('/register', (req, res) => {
    req.flash('error_msg', 'Registrations are currently closed');
    res.redirect('/');
});

// 404 Handler
app.use((req, res) => {
    res.status(404).render('404', { title: 'Page Not Found' });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err.stack);
    res.status(500).render('error', { 
        title: 'Server Error',
        message: 'An unexpected error occurred' 
    });
});

// Start server (hanya untuk development)
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

export default app;