const fs = require('fs');
const path = require('path');

class AttendanceController {
    constructor() {
        this.attendanceFilePath = path.join(__dirname, '../data/attendance.json');
        this.unknownFacesDir = path.join(__dirname, '../data/unknown_faces');
        
        // Ensure directories exist
        if (!fs.existsSync(this.attendanceFilePath)) {
            fs.writeFileSync(this.attendanceFilePath, JSON.stringify([]));
        }
        if (!fs.existsSync(this.unknownFacesDir)) {
            fs.mkdirSync(this.unknownFacesDir, { recursive: true });
        }
    }

    getRecords() {
        try {
            const data = fs.readFileSync(this.attendanceFilePath, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            return [];
        }
    }

    saveRecords(records) {
        fs.writeFileSync(this.attendanceFilePath, JSON.stringify(records, null, 2));
    }

    async markAttendance(req, res) {
        try {
            const { name, timestamp } = req.body;
            
            if (!name) {
                return res.status(400).json({ error: 'Name is required' });
            }

            const attendanceRecord = { 
                name, 
                timestamp: timestamp || new Date().toISOString() 
            };

            const records = this.getRecords();
            records.push(attendanceRecord);
            this.saveRecords(records);

            res.json(attendanceRecord);
        } catch (error) {
            console.error('Error marking attendance:', error);
            res.status(500).json({ error: 'Failed to mark attendance' });
        }
    }

    async getAttendanceLogs(req, res) {
        try {
            const records = this.getRecords();
            res.json(records);
        } catch (error) {
            console.error('Error getting attendance logs:', error);
            res.status(500).json({ error: 'Failed to get attendance logs' });
        }
    }

    async clearAttendanceLogs(req, res) {
        try {
            this.saveRecords([]);
            res.json({ success: true, message: 'Attendance logs cleared' });
        } catch (error) {
            console.error('Error clearing attendance logs:', error);
            res.status(500).json({ error: 'Failed to clear attendance logs' });
        }
    }

    async registerUnknownFace(req, res) {
        try {
            const { name } = req.body;
            
            if (!name) {
                return res.status(400).json({ error: 'Name is required' });
            }

            if (!req.file) {
                return res.status(400).json({ error: 'Face image is required' });
            }

            // Save face image info to a JSON file for record keeping
            const faceRegistryPath = path.join(this.unknownFacesDir, 'registry.json');
            let registry = [];
            
            if (fs.existsSync(faceRegistryPath)) {
                const data = fs.readFileSync(faceRegistryPath, 'utf-8');
                registry = JSON.parse(data);
            }

            const faceRecord = {
                name,
                filename: req.file.filename,
                timestamp: new Date().toISOString(),
                filepath: req.file.path
            };

            registry.push(faceRecord);
            fs.writeFileSync(faceRegistryPath, JSON.stringify(registry, null, 2));

            // Also mark attendance
            const attendanceRecord = {
                name,
                timestamp: new Date().toISOString(),
                type: 'manual_registration'
            };

            const records = this.getRecords();
            records.push(attendanceRecord);
            this.saveRecords(records);

            res.json({
                success: true,
                message: 'Face registered and attendance recorded',
                faceRecord,
                attendanceRecord
            });
        } catch (error) {
            console.error('Error registering unknown face:', error);
            res.status(500).json({ error: 'Failed to register face' });
        }
    }
}

module.exports = AttendanceController;