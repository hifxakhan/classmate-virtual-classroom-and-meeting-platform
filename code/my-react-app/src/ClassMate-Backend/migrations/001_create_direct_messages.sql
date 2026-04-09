-- Direct messages compatibility table.
-- Existing app currently stores chat in chat_message; this migration introduces
-- a direct_messages table for cleaner inbox modeling and future migration.

CREATE TABLE IF NOT EXISTS direct_messages (
    id BIGSERIAL PRIMARY KEY,
    sender_id VARCHAR(64) NOT NULL,
    sender_type VARCHAR(16) NOT NULL CHECK (sender_type IN ('student', 'teacher', 'admin')),
    receiver_id VARCHAR(64) NOT NULL,
    receiver_type VARCHAR(16) NOT NULL CHECK (receiver_type IN ('student', 'teacher', 'admin')),
    message_text TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_dm_receiver_unread
    ON direct_messages (receiver_id, receiver_type, is_read);

CREATE INDEX IF NOT EXISTS idx_dm_pair_time
    ON direct_messages (sender_id, sender_type, receiver_id, receiver_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dm_reverse_pair_time
    ON direct_messages (receiver_id, receiver_type, sender_id, sender_type, created_at DESC);
