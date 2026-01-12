import mysql from 'mysql2/promise';
import { config } from 'dotenv';

config();

// Interface untuk tipe data
export interface User {
    ID?: number;
    Username: string;
    Password: string;
    Salt: string;
    Email: string;
    PhoneNumber: string;
    VerifyCode?: string;
    LoginCode?: string;
    CodeExpiry?: Date;
    IsVerified?: boolean;
    CreatedAt?: Date;
    LastLogin?: Date;
}

// MySQL connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'dbnew.shardox.web.id',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'u1_1AcpbRe4Qp',
    password: process.env.DB_PASSWORD || '.4=8QkgqpDN=DBi!CLCrQV.N',
    database: process.env.DB_NAME || 's1_java',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Connect to database
export const connectDB = async (): Promise<void> => {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Connected to MySQL database');
        connection.release();
        
        // Check accounts table
        try {
            const [rows]: any = await pool.query('DESCRIBE accounts');
            console.log(`✅ Found accounts table with ${rows.length} columns`);
            
            // Check for Password and Salt columns
            const hasPassword = rows.some((col: any) => col.Field === 'Password');
            const hasSalt = rows.some((col: any) => col.Field === 'Salt');
            
            if (!hasPassword) {
                console.warn('⚠️  Password column not found in accounts table');
            }
            if (!hasSalt) {
                console.warn('⚠️  Salt column not found in accounts table');
            }
        } catch (error) {
            console.error('❌ Accounts table not found');
        }
    } catch (error) {
        console.error('❌ Database connection failed:', error);
        process.exit(1);
    }
};

export { pool };