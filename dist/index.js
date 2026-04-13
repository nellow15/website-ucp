"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const express_session_1 = __importDefault(require("express-session"));
const connect_flash_1 = __importDefault(require("connect-flash"));
const dotenv_1 = require("dotenv");
const auth_1 = __importDefault(require("./routes/auth"));
const api_1 = __importDefault(require("./routes/api"));
const verifyRoutes_1 = __importDefault(require("./routes/verifyRoutes"));
const database_1 = require("./database");
// Load environment variables
(0, dotenv_1.config)();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// Connect to database
(0, database_1.connectDB)();
// Middleware
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use(express_1.default.static(path_1.default.join(__dirname, 'public')));
// Session configuration
app.use((0, express_session_1.default)({
    secret: process.env.SESSION_SECRET || 'samp_ucp_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));
app.use((0, connect_flash_1.default)());
// Make flash messages available in all views
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.error = req.flash('error');
    res.locals.user = req.session.user || null;
    next();
});
// View engine setup
app.set('view engine', 'ejs');
app.set('views', path_1.default.join(__dirname, 'views'));
// Routes
app.use('/', auth_1.default);
app.use('/api', api_1.default);
app.use('/verify', verifyRoutes_1.default);
// Home route
app.get('/', (req, res) => {
    res.render('index', {
        title: 'SA:MP UCP Panel',
        user: req.session.user
    });
});
// Dashboard route (protected)
app.get('/dashboard', (req, res) => {
    if (!req.session.user) {
        req.flash('error_msg', 'Please login to access dashboard');
        return res.redirect('/login');
    }
    res.render('dashboard', {
        title: 'Dashboard',
        user: req.session.user
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
app.use((err, req, res, next) => {
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
exports.default = app;
