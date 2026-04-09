-- Adds org-level named repository lists:
--
--   * `repo_lists`                 — named collections of repos.
--   * `repo_list_items`            — N:M membership join (repo can be in many lists).
--   * `boards.synced_list_id`      — optional FK; when set, list membership
--                                    changes propagate to the board's nodes.
--   * `board_nodes.source_list_id` — marks nodes that came from a list so we
--                                    can distinguish list-managed from
--                                    manually-added nodes on the same board.
--
-- Behaviour:
--
--   * Deleting a list cascades through `repo_list_items`. Boards and nodes
--     that referenced it are not cascaded — the FKs are `SET NULL` so boards
--     keep their (now loose) nodes and simply lose the link.
--   * Deleting a repo still cascades to `repo_list_items` and `board_nodes`.
--
-- Foreign-key enforcement is disabled during migration (see `client.ts`),
-- which lets us rebuild `boards` and `board_nodes` to add their new FK
-- columns without SQLite tripping cascade checks against old references.

CREATE TABLE `repo_lists` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `repo_lists_name_idx` ON `repo_lists` (`name`);
--> statement-breakpoint
CREATE TABLE `repo_list_items` (
  `id` text PRIMARY KEY NOT NULL,
  `list_id` text NOT NULL,
  `repo_id` text NOT NULL,
  `added_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
  FOREIGN KEY (`list_id`) REFERENCES `repo_lists`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `repo_list_items_list_id_idx` ON `repo_list_items` (`list_id`);
--> statement-breakpoint
CREATE INDEX `repo_list_items_repo_id_idx` ON `repo_list_items` (`repo_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `repo_list_items_list_repo_unique` ON `repo_list_items` (`list_id`, `repo_id`);
--> statement-breakpoint
ALTER TABLE `boards` ADD COLUMN `synced_list_id` text REFERENCES `repo_lists`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `board_nodes` ADD COLUMN `source_list_id` text REFERENCES `repo_lists`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX `board_nodes_source_list_id_idx` ON `board_nodes` (`source_list_id`);
