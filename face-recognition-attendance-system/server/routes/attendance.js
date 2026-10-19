const express = require('express');
const router = express.Router();
const AttendanceController = require('../controllers/attendanceController');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const uploadDir = path.join(__dirname, '../data/unknown_faces');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, req.body.name + '_' + uniqueSuffix + '.png');
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const attendanceController = new AttendanceController();

// Route to mark attendance
router.post('/attendance', attendanceController.markAttendance.bind(attendanceController));

// Route to get attendance logs
router.get('/attendance', attendanceController.getAttendanceLogs.bind(attendanceController));

// Route to clear attendance logs
router.delete('/attendance', attendanceController.clearAttendanceLogs.bind(attendanceController));

// Route to register unknown face
router.post('/register-unknown', upload.single('face'), attendanceController.registerUnknownFace.bind(attendanceController));

module.exports = router;