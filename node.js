const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// ========== AUTHENTICATION ==========
const ADMIN_PASSWORD = '1234'; // Change this to something secure!

function requireAdmin(req, res, next) {
    const { password } = req.headers;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ message: 'Unauthorized - Invalid password' });
    }
    next();
}

// ========== DATA STORAGE ==========
let attendanceRecords = [];

// Load existing records from CSV on startup (FIXED VERSION)
function loadAttendanceFromCSV() {
    const csvPath = path.join(__dirname, '../attendance.csv');
    if (fs.existsSync(csvPath)) {
        try {
            const data = fs.readFileSync(csvPath, 'utf-8').split('\n').slice(1);
            attendanceRecords = data
                .filter(line => line.trim())
                .map(line => {
                    try {
                        // Remove quotes and split by comma
                        const cleaned = line.replace(/"/g, '').split(',');
                        const name = cleaned[0] ? cleaned[0].trim() : '';
                        const dateStr = cleaned[1] ? cleaned[1].trim() : '';
                        const timeStr = cleaned[2] ? cleaned[2].trim() : '';
                        const confidence = cleaned[3] ? parseFloat(cleaned[3].trim()) : null;

                        // Only add if we have name and valid date
                        if (name && dateStr) {
                            // Try to parse date properly
                            const timestamp = new Date(`${dateStr} ${timeStr || '00:00:00'}`);
                            
                            // Check if date is valid
                            if (!isNaN(timestamp.getTime())) {
                                return {
                                    name,
                                    timestamp: timestamp.toISOString(),
                                    confidence: confidence
                                };
                            }
                        }
                        return null;
                    } catch (e) {
                        console.warn('Error parsing line:', line);
                        return null;
                    }
                })
                .filter(record => record !== null); // Remove null entries
                
            console.log(`✓ Loaded ${attendanceRecords.length} records from CSV`);
        } catch (err) {
            console.warn('Error reading CSV:', err.message);
            attendanceRecords = [];
        }
    }
}

// Save records to CSV
function saveAttendanceToCSV() {
    const csvPath = path.join(__dirname, '../attendance.csv');
    let csvContent = 'Name,Date,Time,Confidence\n';
    
    attendanceRecords.forEach(record => {
        const date = new Date(record.timestamp).toLocaleDateString();
        const time = new Date(record.timestamp).toLocaleTimeString();
        const conf = record.confidence ? record.confidence.toFixed(4) : '';
        csvContent += `"${record.name}","${date}","${time}","${conf}"\n`;
    });
    
    fs.writeFileSync(csvPath, csvContent);
}

// ========== API ENDPOINTS ==========

// POST: Login
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.status(200).json({ 
            message: 'Login successful',
            token: 'authorized',
            timestamp: new Date().toISOString()
        });
    } else {
        res.status(401).json({ message: 'Invalid password' });
    }
});

// POST: Log attendance
app.post('/api/attendance', (req, res) => {
    const { name, timestamp, confidence } = req.body;
    
    if (!name) {
        return res.status(400).json({ message: "Name required" });
    }

    const newRecord = {
        name,
        timestamp: timestamp || new Date().toISOString(),
        confidence: confidence || null
    };

    attendanceRecords.push(newRecord);
    saveAttendanceToCSV();

    console.log(`✓ [LOGGED] ${name} | Confidence: ${confidence ? (confidence * 100).toFixed(0) + '%' : 'N/A'}`);

    res.status(200).json({ 
        message: "Attendance logged successfully",
        record: newRecord 
    });
});

// GET: Retrieve all attendance records
app.get('/api/attendance', (req, res) => {
    res.status(200).json(attendanceRecords);
});

// GET: Retrieve attendance by date
app.get('/api/attendance/date/:date', (req, res) => {
    const { date } = req.params;
    const filtered = attendanceRecords.filter(record => {
        const recordDate = new Date(record.timestamp).toLocaleDateString();
        return recordDate === date;
    });
    res.status(200).json(filtered);
});

// GET: Retrieve attendance by person
app.get('/api/attendance/person/:name', (req, res) => {
    const { name } = req.params;
    const filtered = attendanceRecords.filter(record => 
        record.name.toLowerCase() === name.toLowerCase()
    );
    res.status(200).json(filtered);
});

// GET: Attendance statistics
app.get('/api/statistics', (req, res) => {
    const today = new Date().toLocaleDateString();
    const todayRecords = attendanceRecords.filter(record => {
        const recordDate = new Date(record.timestamp).toLocaleDateString();
        return recordDate === today;
    });

    const uniquePeople = [...new Set(todayRecords.map(r => r.name))];
    const avgConfidence = todayRecords.filter(r => r.confidence).length > 0
        ? (todayRecords.reduce((sum, r) => sum + (r.confidence || 0), 0) / todayRecords.filter(r => r.confidence).length * 100).toFixed(2)
        : 'N/A';

    res.status(200).json({
        totalPresent: uniquePeople.length,
        totalRecords: todayRecords.length,
        averageConfidence: avgConfidence,
        uniquePeople,
        todayRecords
    });
});

// PUT: Update a record (REQUIRES ADMIN PASSWORD)
app.put('/api/attendance/:index', requireAdmin, (req, res) => {
    const { index } = req.params;
    const { name, timestamp, confidence } = req.body;

    if (index < 0 || index >= attendanceRecords.length) {
        return res.status(404).json({ message: "Record not found" });
    }

    attendanceRecords[index] = {
        name: name || attendanceRecords[index].name,
        timestamp: timestamp || attendanceRecords[index].timestamp,
        confidence: confidence !== undefined ? confidence : attendanceRecords[index].confidence
    };

    saveAttendanceToCSV();
    console.log(`✎ [UPDATED] Record ${index} | Admin Password Used`);

    res.status(200).json({ 
        message: "Record updated successfully",
        record: attendanceRecords[index]
    });
});

// DELETE: Remove a specific record (REQUIRES ADMIN PASSWORD)
app.delete('/api/attendance/:index', requireAdmin, (req, res) => {
    const { index } = req.params;

    if (index < 0 || index >= attendanceRecords.length) {
        return res.status(404).json({ message: "Record not found" });
    }

    const deleted = attendanceRecords.splice(index, 1);
    saveAttendanceToCSV();
    console.log(`✗ [DELETED] ${deleted[0].name} | Admin Password Used`);

    res.status(200).json({ 
        message: "Record deleted successfully",
        deleted: deleted[0]
    });
});

// DELETE: Clear all records (REQUIRES ADMIN PASSWORD)
app.delete('/api/attendance', requireAdmin, (req, res) => {
    const count = attendanceRecords.length;
    attendanceRecords = [];
    saveAttendanceToCSV();
    console.log(`✗ [CLEARED] All ${count} records deleted | Admin Password Used`);

    res.status(200).json({ 
        message: `All ${count} records cleared successfully`
    });
});

// GET: Export data as JSON
app.get('/api/export/json', (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="attendance.json"');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(attendanceRecords, null, 2));
});

// GET: Export data as CSV
app.get('/api/export/csv', (req, res) => {
    const csvPath = path.join(__dirname, '../attendance.csv');
    if (fs.existsSync(csvPath)) {
        res.setHeader('Content-Disposition', 'attachment; filename="attendance.csv"');
        res.setHeader('Content-Type', 'text/csv');
        res.download(csvPath);
    } else {
        res.status(404).json({ message: 'CSV file not found' });
    }
});

// GET: Health check
app.get('/api/health', (req, res) => {
    res.status(200).json({ 
        status: 'Server is running',
        recordsCount: attendanceRecords.length,
        timestamp: new Date().toISOString()
    });
});

// ========== AUTO-BACKUP ==========
// Create automatic backup every hour
setInterval(() => {
    const backup = JSON.stringify(attendanceRecords, null, 2);
    const backupPath = path.join(__dirname, `../backups/backup_${new Date().toISOString().split('T')[0]}.json`);
    
    const backupDir = path.join(__dirname, '../backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    
    fs.writeFileSync(backupPath, backup);
    console.log(`💾 [BACKUP] Created at ${backupPath}`);
}, 3600000); // Every hour

// ========== START SERVER ==========
loadAttendanceFromCSV();
app.listen(PORT, () => {
    console.log(`\n╔════════════════════════════════════════╗`);
    console.log(`║  Face Recognition Attendance System   ║`);
    console.log(`║  Server running at http://localhost:${PORT}  ║`);
    console.log(`║  Loaded ${attendanceRecords.length} existing records         ║`);
    console.log(`║  Admin Password: ${ADMIN_PASSWORD}                      ║`);
    console.log(`╚════════════════════════════════════════╝\n`);
});