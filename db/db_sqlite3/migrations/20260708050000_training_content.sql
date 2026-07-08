-- +goose Up
-- SQL in section 'Up' is executed when this migration is applied

CREATE TABLE IF NOT EXISTS "training_modules" (
    "id"                INTEGER PRIMARY KEY AUTOINCREMENT,
    "title"             VARCHAR(255) NOT NULL,
    "locale"            VARCHAR(32) NOT NULL,
    "category"          VARCHAR(128) NOT NULL,
    "difficulty"        VARCHAR(64),
    "estimated_minutes" INTEGER,
    "content_type"      VARCHAR(64) NOT NULL,
    "content_body"      TEXT,
    "external_url"      TEXT,
    "status"            VARCHAR(64) NOT NULL,
    "version"           INTEGER NOT NULL DEFAULT 1,
    "owner_id"          INTEGER,
    "reviewer_id"       INTEGER,
    "reviewed_at"       DATETIME,
    "created_at"        DATETIME,
    "updated_at"        DATETIME
);

CREATE TABLE IF NOT EXISTS "training_lessons" (
    "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
    "module_id"  INTEGER NOT NULL,
    "title"      VARCHAR(255) NOT NULL,
    "body"       TEXT,
    "sort_order" INTEGER,
    "created_at" DATETIME,
    "updated_at" DATETIME
);

CREATE TABLE IF NOT EXISTS "quizzes" (
    "id"            INTEGER PRIMARY KEY AUTOINCREMENT,
    "module_id"     INTEGER NOT NULL,
    "title"         VARCHAR(255) NOT NULL,
    "passing_score" INTEGER NOT NULL DEFAULT 80,
    "created_at"    DATETIME,
    "updated_at"    DATETIME
);

CREATE TABLE IF NOT EXISTS "quiz_questions" (
    "id"            INTEGER PRIMARY KEY AUTOINCREMENT,
    "quiz_id"       INTEGER NOT NULL,
    "question_text" TEXT NOT NULL,
    "question_type" VARCHAR(64) NOT NULL,
    "points"        INTEGER NOT NULL DEFAULT 1,
    "sort_order"    INTEGER,
    "created_at"    DATETIME,
    "updated_at"    DATETIME
);

CREATE TABLE IF NOT EXISTS "quiz_answers" (
    "id"               INTEGER PRIMARY KEY AUTOINCREMENT,
    "question_id"      INTEGER NOT NULL,
    "answer_text"      TEXT NOT NULL,
    "is_correct"       BOOLEAN NOT NULL DEFAULT 0,
    "explanation_text" TEXT,
    "sort_order"       INTEGER,
    "created_at"       DATETIME,
    "updated_at"       DATETIME
);

CREATE TABLE IF NOT EXISTS "training_assignments" (
    "id"              INTEGER PRIMARY KEY AUTOINCREMENT,
    "campaign_id"     INTEGER,
    "result_id"       INTEGER,
    "r_id"            VARCHAR(255),
    "recipient_email" VARCHAR(255),
    "module_id"       INTEGER NOT NULL,
    "assigned_by"     INTEGER,
    "status"          VARCHAR(64) NOT NULL,
    "reason"          TEXT,
    "assigned_at"     DATETIME,
    "due_at"          DATETIME
);

CREATE TABLE IF NOT EXISTS "training_completions" (
    "id"                INTEGER PRIMARY KEY AUTOINCREMENT,
    "assignment_id"     INTEGER NOT NULL,
    "module_id"         INTEGER NOT NULL,
    "r_id"              VARCHAR(255),
    "score"             INTEGER,
    "passed"            BOOLEAN,
    "attempts_count"    INTEGER,
    "completed_at"      DATETIME,
    "completion_source" VARCHAR(128)
);

CREATE TABLE IF NOT EXISTS "training_feedbacks" (
    "id"            INTEGER PRIMARY KEY AUTOINCREMENT,
    "assignment_id" INTEGER,
    "module_id"     INTEGER,
    "r_id"          VARCHAR(255),
    "rating"        INTEGER,
    "comment"       TEXT,
    "created_at"    DATETIME
);

INSERT INTO "training_modules" ("title", "locale", "category", "difficulty", "estimated_minutes", "content_type", "content_body", "status", "version", "created_at", "updated_at")
SELECT '辨識可疑郵件的五個線索', 'zh-TW', 'phishing_recognition', 'beginner', 5, 'markdown',
'檢查寄件者、連結網域、語氣壓力、附件類型與不尋常要求。遇到疑慮時，先回報，不要輸入密碼。', 'draft', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "training_modules" WHERE "title" = '辨識可疑郵件的五個線索' AND "locale" = 'zh-TW');

INSERT INTO "training_modules" ("title", "locale", "category", "difficulty", "estimated_minutes", "content_type", "content_body", "status", "version", "created_at", "updated_at")
SELECT '安全處理登入與表單', 'zh-TW', 'safe_form_handling', 'beginner', 6, 'markdown',
'在任何演練或可疑頁面中，不輸入真實密碼、驗證碼或個資。若已送出資訊，請立即依內部流程通報。', 'draft', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "training_modules" WHERE "title" = '安全處理登入與表單' AND "locale" = 'zh-TW');

INSERT INTO "training_modules" ("title", "locale", "category", "difficulty", "estimated_minutes", "content_type", "content_body", "status", "version", "created_at", "updated_at")
SELECT '正確回報可疑郵件', 'zh-TW', 'positive_reinforcement', 'beginner', 4, 'markdown',
'回報是防護流程的一部分。保留郵件、使用公司核准的回報管道，並避免轉寄給不相關收件者。', 'draft', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "training_modules" WHERE "title" = '正確回報可疑郵件' AND "locale" = 'zh-TW');

INSERT INTO "training_modules" ("title", "locale", "category", "difficulty", "estimated_minutes", "content_type", "content_body", "status", "version", "created_at", "updated_at")
SELECT '商務郵件詐騙與請款驗證', 'zh-TW', 'advanced_awareness', 'intermediate', 8, 'markdown',
'遇到付款、帳號變更或急迫授權要求時，使用已知的第二通道確認，不依郵件中的聯絡方式單獨決策。', 'draft', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "training_modules" WHERE "title" = '商務郵件詐騙與請款驗證' AND "locale" = 'zh-TW');

-- +goose Down
-- SQL section 'Down' is executed when this migration is rolled back

DROP TABLE "training_feedbacks";
DROP TABLE "training_completions";
DROP TABLE "training_assignments";
DROP TABLE "quiz_answers";
DROP TABLE "quiz_questions";
DROP TABLE "quizzes";
DROP TABLE "training_lessons";
DROP TABLE "training_modules";
