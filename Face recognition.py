lool    import cv2
import face_recognition
import numpy as np
import os

KNOWN_FACES_DIR = "known_faces"
known_face_encodings = []
known_face_names = []
MATCH_THRESHOLD = 0.45


def load_known_faces():
    global known_face_encodings, known_face_names

    known_face_encodings = []
    known_face_names = []

    if not os.path.exists(KNOWN_FACES_DIR):
        os.makedirs(KNOWN_FACES_DIR)
        print(f"Created '{KNOWN_FACES_DIR}' directory. Please add target images and re-run.")
        return False

    print("Loading known faces...")

    for person_name in os.listdir(KNOWN_FACES_DIR):
        person_dir = os.path.join(KNOWN_FACES_DIR, person_name)

        if not os.path.isdir(person_dir):
            continue

        for filename in os.listdir(person_dir):
            if not filename.lower().endswith(('.jpg', '.jpeg', '.png')):
                continue

            image_path = os.path.join(person_dir, filename)
            bgr_img = cv2.imread(image_path)

            if bgr_img is None:
                continue

            rgb_img = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2RGB)
            encodings = face_recognition.face_encodings(rgb_img)

            if encodings:
                known_face_encodings.append(encodings[0])
                known_face_names.append(person_name)
                print(f"Loaded: {person_name}")

    return len(known_face_encodings) > 0


def recognize_face(face_encoding):
    if not known_face_encodings:
        return "Unknown"

    face_distances = face_recognition.face_distance(known_face_encodings, face_encoding)
    if len(face_distances) == 0:
        return "Unknown"

    best_match_index = np.argmin(face_distances)
    best_distance = float(face_distances[best_match_index])

    if best_distance <= MATCH_THRESHOLD:
        return known_face_names[best_match_index]

    return "Unknown"


def start_scanner():
    video_capture = cv2.VideoCapture(0)

    if not video_capture.isOpened():
        print("Error: Could not open webcam.")
        return

    print("Starting camera... Press 'q' on your keyboard to exit!")
    print(f"Recognition threshold: {MATCH_THRESHOLD}")

    while True:
        ret, frame = video_capture.read()
        if not ret:
            print("Failed to grab frame.")
            break

        small_frame = cv2.resize(frame, (0, 0), fx=0.25, fy=0.25)
        rgb_small_frame = cv2.cvtColor(small_frame, cv2.COLOR_BGR2RGB)

        face_locations = face_recognition.face_locations(rgb_small_frame, model="cnn")
        face_encodings = face_recognition.face_encodings(rgb_small_frame, face_locations)

        face_names = []
        for face_encoding in face_encodings:
            face_names.append(recognize_face(face_encoding))

        for (top, right, bottom, left), name in zip(face_locations, face_names):
            top *= 4
            right *= 4
            bottom *= 4
            left *= 4

            box_color = (0, 255, 0) if name != "Unknown" else (0, 0, 255)
            cv2.rectangle(frame, (left, top), (right, bottom), box_color, 2)
            cv2.rectangle(frame, (left, bottom - 35), (right, bottom), box_color, cv2.FILLED)
            font = cv2.FONT_HERSHEY_DUPLEX
            cv2.putText(frame, name, (left + 6, bottom - 6), font, 0.8, (255, 255, 255), 1)

        cv2.imshow('Face Recognition Scanner', frame)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    video_capture.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    if load_known_faces():
        start_scanner()
    else:
        print("Please place at least one image inside the 'known_faces' folder.")