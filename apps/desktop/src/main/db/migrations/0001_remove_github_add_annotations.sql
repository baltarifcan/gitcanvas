-- Removes the GitHub integration tables/columns and adds repo_annotations.
--
-- This is a hand-written migration because drizzle-kit can't disambiguate
-- the rename-vs-delete semantics non-interactively. The runtime migrator
-- (drizzle-orm/better-sqlite3/migrator) reads SQL files in order from the
-- meta/_journal.json index — see client.ts for the FK toggling that wraps
-- this. Statements are split on the breakpoint marker.

DROP TABLE IF EXISTS `board_sources`;
--> statement-breakpoint
DROP TABLE IF EXISTS `accounts`;
--> statement-breakpoint
-- Rebuild `repos` to drop the github-specific columns and tighten
-- `local_path` to NOT NULL. Github-source rows (which had local_path = NULL)
-- are filtered out of the copy, since they no longer fit the new shape.
CREATE TABLE `__new_repos` (
  `id` text PRIMARY KEY NOT NULL,
  `owner` text NOT NULL,
  `name` text NOT NULL,
  `full_name` text NOT NULL,
  `description` text,
  `primary_language` text,
  `default_branch` text,
  `local_path` text NOT NULL,
  `topics` text DEFAULT '[]' NOT NULL,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_repos` (`id`, `owner`, `name`, `full_name`, `description`, `primary_language`, `default_branch`, `local_path`, `topics`, `created_at`)
SELECT `id`, `owner`, `name`, `full_name`, `description`, `primary_language`, `default_branch`, `local_path`, `topics`, `created_at`
FROM `repos`
WHERE `source` = 'local' AND `local_path` IS NOT NULL;
--> statement-breakpoint
DROP TABLE `repos`;
--> statement-breakpoint
ALTER TABLE `__new_repos` RENAME TO `repos`;
--> statement-breakpoint
CREATE INDEX `repos_full_name_idx` ON `repos` (`full_name`);
--> statement-breakpoint
CREATE INDEX `repos_local_path_idx` ON `repos` (`local_path`);
--> statement-breakpoint
-- Drop board_node rows that referenced now-deleted github repos.
-- The board_nodes FK to repos has ON DELETE CASCADE but the table rebuild
-- above bypasses that, so we sweep them up explicitly.
DELETE FROM `board_nodes`
WHERE `kind` = 'repo'
  AND (`repo_id` IS NULL OR `repo_id` NOT IN (SELECT `id` FROM `repos`));
--> statement-breakpoint
CREATE TABLE `repo_annotations` (
  `id` text PRIMARY KEY NOT NULL,
  `repo_id` text NOT NULL,
  `branch_name` text,
  `kind` text NOT NULL,
  `data` text DEFAULT '{}' NOT NULL,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
  FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `repo_annotations_repo_id_idx` ON `repo_annotations` (`repo_id`);
--> statement-breakpoint
CREATE INDEX `repo_annotations_branch_idx` ON `repo_annotations` (`repo_id`, `branch_name`);
