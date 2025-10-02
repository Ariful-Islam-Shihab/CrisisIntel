-- Part 2 Schema Extension: Blood Requests, Donor Recruitment, Applications
-- Assumes users table with roles including hospital, social_org, blood_bank, regular.

-- Table: blood_requests (created by hospital users)
CREATE TABLE IF NOT EXISTS blood_requests (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  hospital_user_id BIGINT NOT NULL,
  blood_type       VARCHAR(5) NOT NULL,
  quantity_units   INT NOT NULL DEFAULT 1, -- approximate units needed
  needed_by        DATETIME NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'open', -- open|fulfilled|cancelled
  notes            TEXT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_breq_status (status),
  INDEX idx_breq_btype (blood_type),
  INDEX idx_breq_hospital (hospital_user_id)
  -- FOREIGN KEY (hospital_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Table: blood_donor_recruit_posts (created by social_org or blood_bank users)
CREATE TABLE IF NOT EXISTS blood_donor_recruit_posts (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  owner_user_id      BIGINT NOT NULL,
  blood_request_id   BIGINT NULL, -- optional link to a specific hospital request
  target_blood_type  VARCHAR(5) NULL,
  location_text      VARCHAR(255) NULL,
  scheduled_at       DATETIME NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'active', -- active|closed
  notes              TEXT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_recruit_status (status),
  INDEX idx_recruit_owner (owner_user_id)
  -- FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  -- FOREIGN KEY (blood_request_id) REFERENCES blood_requests(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Table: blood_donor_applications (donor (regular user) applies to a recruit post)
CREATE TABLE IF NOT EXISTS blood_donor_applications (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  recruit_post_id    BIGINT NOT NULL,
  donor_user_id      BIGINT NOT NULL,
  availability_at    DATETIME NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|accepted|rejected|attended
  notes              TEXT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_application (recruit_post_id, donor_user_id),
  INDEX idx_app_status (status),
  INDEX idx_app_recruit (recruit_post_id),
  INDEX idx_app_donor (donor_user_id)
  -- FOREIGN KEY (recruit_post_id) REFERENCES blood_donor_recruit_posts(id) ON DELETE CASCADE,
  -- FOREIGN KEY (donor_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Future: attendance logs, donation units tracking, cross-match verification.
