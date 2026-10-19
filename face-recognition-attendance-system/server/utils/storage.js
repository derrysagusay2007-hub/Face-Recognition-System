const fs = require('fs');
const path = require('path');

const attendanceFilePath = path.join(__dirname, '../data/attendance.json');

function readAttendanceRecords() {
    if (!fs.existsSync(attendanceFilePath)) {
        return [];
    }
    const data = fs.readFileSync(attendanceFilePath, 'utf-8');
    return JSON.parse(data);
}

function writeAttendanceRecords(records) {
    fs.writeFileSync(attendanceFilePath, JSON.stringify(records, null, 2));
}

module.exports = {
    readAttendanceRecords,
    writeAttendanceRecords
};