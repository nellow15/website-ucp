"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = exports.connectDB = void 0;
const promise_1 = __importDefault(require("mysql2/promise"));
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
// MySQL connection pool
const pool = promise_1.default.createPool({
    host: process.env.DB_HOST || 'dbnew.shardox.web.id',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'u1_1AcpbRe4Qp',
    password: process.env.DB_PASSWORD || '.4=8QkgqpDN=DBi!CLCrQV.N',
    database: process.env.DB_NAME || 's1_java',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});
exports.pool = pool;
// Connect to database
const connectDB = async () => {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Connected to MySQL database');
        connection.release();
        // Check accounts table
        try {
            const [rows] = await pool.query('DESCRIBE accounts');
            console.log(`✅ Found accounts table with ${rows.length} columns`);
            // Check for Password and Salt columns
            const hasPassword = rows.some((col) => col.Field === 'Password');
            const hasSalt = rows.some((col) => col.Field === 'Salt');
            if (!hasPassword) {
                console.warn('⚠️  Password column not found in accounts table');
            }
            if (!hasSalt) {
                console.warn('⚠️  Salt column not found in accounts table');
            }
        }
        catch (error) {
            console.error('❌ Accounts table not found');
        }
    }
    catch (error) {
        console.error('❌ Database connection failed:', error);
        process.exit(1);
    }
};
exports.connectDB = connectDB;
