const video = document.getElementById('webcam');
const statusText = document.getElementById('status');
const tableBody = document.getElementById('attendance-list');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');
const totalCountDisplay = document.getElementById('total-count');
const manualOverrideBtn = document.getElementById('manualOverrideBtn');
const manualNameSelect = document.getElementById('manualNameSelect');

const notification = document.getElementById('notification');
const livenessStatus = document.getElementById('liveness-status');
const hasBlinkVerified = new Map();

const LABELED_PEOPLE = [
    { label: 'Derry', images: ['1.jpg'] }
];
let faceMatcher = null;

const attendanceStorageKey = 'face_attendance_records_v1';
const lastScannedTime = new Map();
const COOLDOWN_MS = 10 * 60 * 1000;

// Manual registration tracking
const modal = document.getElementById('manualRegistrationModal');
const studentNameInput = document.getElementById('studentName');
const captureAndRegisterBtn = document.getElementById('captureAndRegisterBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const manualRegisterBtn = document.getElementById('manualRegisterBtn');

// Signature pad elements
const signaturePad = document.getElementById('signaturePad');
const clearSignatureBtn = document.getElementById('clearSignatureBtn');
const undoSignatureBtn = document.getElementById('undoSignatureBtn');
const proceedToSignatureBtn = document.getElementById('proceedToSignatureBtn');
const cancelFromStep1Btn = document.getElementById('cancelFromStep1Btn');
const cancelFromStep2Btn = document.getElementById('cancelFromStep2Btn');
const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');

// Signature drawing state
let isDrawing = false;
let signatureStrokes = [];
let currentStroke = [];
let signatureContext = null;

let currentUnknownFaceDetected = false;
let lastUnknownFaceTime = 0;
const UNKNOWN_FACE_DEBOUNCE = 5000;

let presentCount = 0;
let eyeOpenMax = 0;

function getStoredRecords() {
    try {
        return JSON.parse(localStorage.getItem(attendanceStorageKey) || '[]');
    } catch {
        return [];
    }
}

function saveStoredRecords(records) {
    localStorage.setItem(attendanceStorageKey, JSON.stringify(records));
}

function isSameDay(dateValue) {
    const d = new Date(dateValue);
    const now = new Date();

    return d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate();
}

function hasAlreadyMarkedToday(name) {
    const records = getStoredRecords();
    return records.some(record =>
        record.name === name && isSameDay(record.timestamp)
    );
}

function playBeepSound(frequency = 800, duration = 0.15) {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + duration);
    } catch (e) {
        console.error('Audio playback error:', e);
    }
}

function speakMessage(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        window.speechSynthesis.speak(utterance);
    }
}

function showNotification(message, isSuccess = true) {
    notification.innerText = message;
    notification.style.backgroundColor = isSuccess ? '#00ffcc' : '#ff9900';
    notification.style.color = '#121212';
    notification.style.display = 'block';

    setTimeout(() => {
        notification.style.display = 'none';
    }, 3000);
}

// Modal control functions
function openManualRegistrationModal() {
    modal.classList.add('show');
    studentNameInput.focus();
    studentNameInput.value = '';
    captureAndRegisterBtn.disabled = false;
}

function closeManualRegistrationModal() {
    modal.classList.remove('show');
    currentUnknownFaceDetected = false;
    manualRegisterBtn.style.display = 'none';
}

function showUnknownFaceButton() {
    const now = Date.now();
    if (now - lastUnknownFaceTime > UNKNOWN_FACE_DEBOUNCE && !currentUnknownFaceDetected) {
        currentUnknownFaceDetected = true;
        lastUnknownFaceTime = now;
        manualRegisterBtn.style.display = 'block';
        showNotification('⚠️ Face not recognized. Click the red button to register manually.', false);
    }
}

function hideUnknownFaceButton() {
    manualRegisterBtn.style.display = 'none';
    currentUnknownFaceDetected = false;
}

function getEuclideanDistance(pt1, pt2) {
    return Math.sqrt(Math.pow(pt1.x - pt2.x, 2) + Math.pow(pt1.y - pt2.y, 2));
}

function getEyeAspectRatio(eyeLandmarks) {
    const p2_p6 = getEuclideanDistance(eyeLandmarks[1], eyeLandmarks[5]);
    const p3_p5 = getEuclideanDistance(eyeLandmarks[2], eyeLandmarks[4]);
    const p1_p4 = getEuclideanDistance(eyeLandmarks[0], eyeLandmarks[3]);

    return (p2_p6 + p3_p5) / (2.0 * p1_p4);
}

function isBlinking(landmarks, faceBox) {
    const leftEye = landmarks.getLeftEye();
    const rightEye = landmarks.getRightEye();

    const leftEAR = getEyeAspectRatio(leftEye);
    const rightEAR = getEyeAspectRatio(rightEye);
    const avgEAR = (leftEAR + rightEAR) / 2.0;

    const leftVertical = getEuclideanDistance(leftEye[1], leftEye[5]);
    const rightVertical = getEuclideanDistance(rightEye[1], rightEye[5]);
    const rawAvgVertical = (leftVertical + rightVertical) / 2.0;

    const faceWidth = faceBox ? faceBox.width : 200;
    const normalizedEyeHeight = rawAvgVertical / faceWidth;

    if (avgEAR > eyeOpenMax && avgEAR < 0.35) {
        eyeOpenMax = avgEAR;
    }

    const relativeDrop = eyeOpenMax > 0 ? (eyeOpenMax - avgEAR) / eyeOpenMax : 0;

    if (avgEAR < 0.245 || relativeDrop > 0.18 || normalizedEyeHeight < 0.022) {
        return true;
    }

    return false;
}

function renderTableRow(name, timeString, isNew = true) {
    const row = document.createElement('tr');
    row.innerHTML = `
        <td style="color: #00ffcc; font-weight: bold;">${name}</td>
        <td>${timeString}</td>
    `;
    tableBody.prepend(row);

    if (isNew) {
        presentCount++;
        totalCountDisplay.innerText = presentCount;
    }
}

async function loadSavedAttendance() {
    try {
        let localRecords = getStoredRecords();

        try {
            const response = await fetch('http://localhost:3000/api/attendance');
            if (response.ok) {
                const backendLogs = await response.json();
                if (backendLogs && backendLogs.length > 0) {
                    localRecords = backendLogs;
                    saveStoredRecords(backendLogs);
                }
            }
        } catch (err) {
            console.warn('Backend unavailable, using local storage.');
        }

        tableBody.innerHTML = '';
        presentCount = 0;

        localRecords
            .filter(log => log && log.name && log.timestamp)
            .filter(log => isSameDay(log.timestamp))
            .forEach(log => {
                const timeFormatted = new Date(log.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });

                renderTableRow(log.name, timeFormatted, false);
            });

        totalCountDisplay.innerText = presentCount;
    } catch (err) {
        console.error('Failed to load attendance:', err);
    }
}

async function markAttendance(name, force = false) {
    if (!name || name === 'unknown' || name === 'Unknown') {
        return false;
    }

    const nowTime = Date.now();
    const lastTime = lastScannedTime.get(name) || 0;

    if (!force && nowTime - lastTime < COOLDOWN_MS) {
        return false;
    }

    if (!force && hasAlreadyMarkedToday(name)) {
        return false;
    }

    lastScannedTime.set(name, nowTime);

    const timestamp = new Date().toISOString();
    const timeString = new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    const records = getStoredRecords();
    records.push({ name, timestamp });
    saveStoredRecords(records);

    renderTableRow(name, timeString, true);
    hasBlinkVerified.set(name, false);

    playBeepSound(900, 0.2);
    speakMessage(`Attendance logged for ${name}`);
    showNotification(`✓ Welcome, ${name}! Attendance Recorded.`, true);

    try {
        await fetch('http://localhost:3000/api/attendance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, timestamp })
        });
    } catch (err) {
        console.warn('Backend unavailable; saved locally.');
    }

    return true;
}

async function init() {
    await loadSavedAttendance();

    try {
        statusText.innerText = 'Downloading AI Models...';
        const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js/weights';

        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);

        statusText.innerText = 'Loading reference photos...';
        const labeledDescriptors = await loadLabeledImages();

        if (labeledDescriptors && labeledDescriptors.length > 0) {
            faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.65);
            statusText.innerText = 'Scanner Ready!';
        } else {
            statusText.innerText = 'No photos found. Running in generic mode.';
        }

        startVideo();
    } catch (err) {
        statusText.innerText = 'Error loading AI models. Check internet connection.';
        console.error('Init Error:', err);
        startVideo();
    }
}

function loadLabeledImages() {
    return Promise.all(
        LABELED_PEOPLE.map(async person => {
            const descriptors = await Promise.all(person.images.map(async imageName => {
                const imgUrl = `./labeled_images/${person.label}/${imageName}`;
                try {
                    statusText.innerText = `Loading photo for ${person.label}...`;

                    const img = await faceapi.fetchImage(imgUrl);
                    const detections = await faceapi.detectSingleFace(
                        img,
                        new faceapi.TinyFaceDetectorOptions()
                    ).withFaceLandmarks().withFaceDescriptor();

                    if (!detections) {
                        console.warn(`No face detected in photo at ${imgUrl}`);
                        return null;
                    }

                    return detections.descriptor;
                } catch (e) {
                    console.error(`Could not load image at ${imgUrl}`, e);
                    return null;
                }
            }));

            const validDescriptors = descriptors.filter(Boolean);
            return validDescriptors.length > 0
                ? new faceapi.LabeledFaceDescriptors(person.label, validDescriptors)
                : null;
        })
    ).then(results => results.filter(Boolean));
}

function startVideo() {
    navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
        .then(stream => {
            video.srcObject = stream;
        })
        .catch(err => {
            statusText.innerText = 'Camera access denied.';
            console.error('Camera error:', err);
        });
}

exportBtn.addEventListener('click', () => {
    const rows = Array.from(tableBody.querySelectorAll('tr'));
    if (rows.length === 0) {
        alert('No attendance records to export!');
        return;
    }

    let csvContent = 'Name,Time\n';
    rows.forEach(row => {
        const cols = row.querySelectorAll('td');
        csvContent += `"${cols[0].innerText}","${cols[1].innerText}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    const today = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `Attendance_Log_${today}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

clearBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear the attendance log?')) {
        lastScannedTime.clear();
        hasBlinkVerified.clear();
        eyeOpenMax = 0;
        presentCount = 0;
        totalCountDisplay.innerText = 0;
        tableBody.innerHTML = '';
        localStorage.removeItem(attendanceStorageKey);

        try {
            fetch('http://localhost:3000/api/attendance', {
                method: 'DELETE'
            });
        } catch (err) {
            console.warn('Server clear failed; local records were cleared.');
        }
    }
});

manualOverrideBtn.addEventListener('click', () => {
    const selectedPerson = manualNameSelect.value;
    markAttendance(selectedPerson, true);
});

video.addEventListener('play', () => {
    const container = document.getElementById('video-container');
    const canvas = faceapi.createCanvasFromMedia(video);
    container.append(canvas);

    const displaySize = { width: 640, height: 480 };
    faceapi.matchDimensions(canvas, displaySize);

    setInterval(async () => {
        if (video.paused || video.ended) return;

        const detections = await faceapi.detectAllFaces(
            video,
            new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 })
        ).withFaceLandmarks().withFaceDescriptors();

        const resizedDetections = faceapi.resizeResults(detections, displaySize);

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (resizedDetections.length === 0) {
            livenessStatus.style.display = 'none';
            return;
        } else {
            livenessStatus.style.display = 'block';
        }

        resizedDetections.forEach((detection) => {
            const box = detection.detection.box;
            const landmarks = detection.landmarks;

            const mirroredBox = {
                x: displaySize.width - box.x - box.width,
                y: box.y,
                width: box.width,
                height: box.height
            };

            let labelText = 'Scanning...';
            let boxColor = '#00ffcc';

            if (faceMatcher) {
                const match = faceMatcher.findBestMatch(detection.descriptor);
                const matchedName = match.label;

                if (matchedName !== 'unknown') {
                    const userBlinked = isBlinking(landmarks, box);

                    if (userBlinked) {
                        hasBlinkVerified.set(matchedName, true);
                    }

                    if (hasBlinkVerified.get(matchedName)) {
                        boxColor = '#00ff88';
                        labelText = `${matchedName} (Verified Live)`;
                        livenessStatus.innerText = '✓ Blink Verified!';
                        livenessStatus.style.borderColor = '#00ff88';
                        livenessStatus.style.color = '#00ff88';

                        if (markAttendance(matchedName)) {
                            hasBlinkVerified.set(matchedName, false);
                        }
                    } else {
                        boxColor = '#ffcc00';
                        labelText = `${matchedName} - Blink to Confirm`;
                        livenessStatus.innerText = '👁️ Please Blink to Confirm';
                        livenessStatus.style.borderColor = '#ffcc00';
                        livenessStatus.style.color = '#ffcc00';
                    }
                } else {
                    boxColor = '#ff4444';
                    labelText = 'Unknown Person';
                    livenessStatus.innerText = '❌ Unrecognized Face';
                    livenessStatus.style.borderColor = '#ff4444';
                    livenessStatus.style.color = '#ff4444';
                    showUnknownFaceButton();
                }
            }

            const drawBox = new faceapi.draw.DrawBox(mirroredBox, {
                label: labelText,
                boxColor: boxColor,
                lineWidth: 2
            });

            drawBox.draw(canvas);
        });
    }, 100);
});

// Manual Registration Modal Event Listeners
manualRegisterBtn.addEventListener('click', openManualRegistrationModal);

closeModalBtn.addEventListener('click', closeManualRegistrationModal);

cancelFromStep1Btn.addEventListener('click', closeManualRegistrationModal);
cancelFromStep2Btn.addEventListener('click', closeManualRegistrationModal);

modal.addEventListener('click', (e) => {
    if (e.target === modal) {
        closeManualRegistrationModal();
    }
});

// Capture and register face with name
captureAndRegisterBtn.addEventListener('click', async () => {
    const studentName = studentNameInput.value.trim();
    
    if (!studentName) {
        showNotification('❌ Please enter your name', false);
        return;
    }

    if (studentName.length < 2) {
        showNotification('❌ Name must be at least 2 characters', false);
        return;
    }

    captureAndRegisterBtn.disabled = true;
    captureAndRegisterBtn.textContent = 'Processing...';

    try {
        // Get the canvas and capture the current frame
        const container = document.getElementById('video-container');
        const canvas = container.querySelector('canvas');
        
        if (!canvas) {
            showNotification('❌ Camera not ready. Please try again.', false);
            captureAndRegisterBtn.disabled = false;
            captureAndRegisterBtn.textContent = 'Capture Face & Register';
            return;
        }

        // Convert canvas to blob
        canvas.toBlob(async (blob) => {
            try {
                // Create FormData to send image and name
                const formData = new FormData();
                formData.append('name', studentName);
                formData.append('face', blob, `${studentName}_${Date.now()}.png`);

                // Send to backend
                const response = await fetch('http://localhost:3000/api/attendance/register-unknown', {
                    method: 'POST',
                    body: formData
                });

                if (response.ok) {
                    const result = await response.json();
                    // Mark attendance
                    await markAttendance(studentName, true);
                    
                    showNotification(`✓ Welcome, ${studentName}! Face registered & attendance recorded.`, true);
                    speakMessage(`Attendance recorded for ${studentName}`);
                    playBeepSound(900, 0.2);
                    
                    closeManualRegistrationModal();
                } else {
                    showNotification('❌ Failed to register. Please try again.', false);
                }
            } catch (error) {
                console.error('Upload error:', error);
                showNotification('❌ Error registering face. Attendance recorded locally.', false);
                // Still mark attendance locally even if upload fails
                await markAttendance(studentName, true);
                closeManualRegistrationModal();
            } finally {
                captureAndRegisterBtn.disabled = false;
                captureAndRegisterBtn.textContent = 'Capture Face & Register';
            }
        }, 'image/png');
    } catch (error) {
        console.error('Error:', error);
        showNotification('❌ An error occurred. Please try again.', false);
        captureAndRegisterBtn.disabled = false;
        captureAndRegisterBtn.textContent = 'Capture Face & Register';
    }
});

// Allow Enter key to submit
studentNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        captureAndRegisterBtn.click();
    }
});

window.addEventListener('DOMContentLoaded', init);