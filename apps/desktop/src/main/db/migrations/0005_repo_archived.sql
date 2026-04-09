-- Adds an `archived` flag to the `repos` table.
--
-- Archived is a global per-repo state (not per-board-instance) so that
-- retiring a repo propagates everywhere it's referenced. Stored as INTEGER
-- (0/1); mapped to boolean at the IPC boundary.

ALTER TABLE `repos` ADD COLUMN `archived` integer NOT NULL DEFAULT 0;
