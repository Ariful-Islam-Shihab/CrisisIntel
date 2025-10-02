-- Part 1 Schema Extension: Hospital Doctor Membership, Schedules, Appointments
-- This script assumes base tables: users, posts, post_comments, post_shares, auth_tokens already exist.
-- Execute in MySQL. Adjust engine/charset as needed.
USE crisisintel;
-- Table: hospital_doctors
-- Maps a hospital account (users.role='hospital') to a doctor user (any regular user functioning as doctor).
CREATE TABLE IF NOT EXISTS hospital_doctors (
  hospital_user_id BIGINT NOT NULL,
  doctor_user_id   BIGINT NOT NULL,
  added_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (hospital_user_id, doctor_user_id)
  -- FOREIGN KEY (hospital_user_id) REFERENCES users(id) ON DELETE CASCADE,
  -- FOREIGN KEY (doctor_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Table: doctor_schedules
-- Each row denotes a weekly recurring availability block.
-- weekday: 0=Monday .. 6=Sunday (choose convention; documented in README)
CREATE TABLE IF NOT EXISTS doctor_schedules (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  doctor_user_id   BIGINT NOT NULL,
  hospital_user_id BIGINT NOT NULL,
  weekday          TINYINT NOT NULL,
  start_time       TIME NOT NULL,
  end_time         TIME NOT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_doc_hosp_day (doctor_user_id, hospital_user_id, weekday)
  -- FOREIGN KEY (doctor_user_id) REFERENCES users(id) ON DELETE CASCADE,
  -- FOREIGN KEY (hospital_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Table: appointments
-- Represents a booked time slot between patient (regular user) and doctor at a hospital.
CREATE TABLE IF NOT EXISTS appointments (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  patient_user_id  BIGINT NOT NULL,
  doctor_user_id   BIGINT NOT NULL,
  hospital_user_id BIGINT NOT NULL,
  starts_at        DATETIME NOT NULL,
  ends_at          DATETIME NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'booked', -- booked|cancelled|completed
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_doc_time (doctor_user_id, starts_at),
  INDEX idx_patient (patient_user_id),
  INDEX idx_hospital (hospital_user_id)
  -- FOREIGN KEY (patient_user_id) REFERENCES users(id) ON DELETE CASCADE,
  -- FOREIGN KEY (doctor_user_id) REFERENCES users(id) ON DELETE CASCADE,
  -- FOREIGN KEY (hospital_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Helper view (optional) to quickly see doctor membership; can be created later if needed.
-- CREATE VIEW v_hospital_doctors AS
-- SELECT hd.hospital_user_id, hd.doctor_user_id, u.full_name AS doctor_name
-- FROM hospital_doctors hd JOIN users u ON u.id = hd.doctor_user_id;

-- Idempotent inserts/updates can be handled in code; constraints ensure no duplicates.
