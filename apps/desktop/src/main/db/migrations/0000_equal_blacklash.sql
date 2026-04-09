CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`login` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`encrypted_token` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_login_unique` ON `accounts` (`login`);--> statement-breakpoint
CREATE TABLE `board_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`kind` text NOT NULL,
	`repo_id` text,
	`parent_id` text,
	`x` real DEFAULT 0 NOT NULL,
	`y` real DEFAULT 0 NOT NULL,
	`width` real DEFAULT 240 NOT NULL,
	`height` real DEFAULT 140 NOT NULL,
	`z_index` integer DEFAULT 0 NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `board_nodes_board_id_idx` ON `board_nodes` (`board_id`);--> statement-breakpoint
CREATE INDEX `board_nodes_repo_id_idx` ON `board_nodes` (`repo_id`);--> statement-breakpoint
CREATE INDEX `board_nodes_parent_id_idx` ON `board_nodes` (`parent_id`);--> statement-breakpoint
CREATE TABLE `board_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`kind` text NOT NULL,
	`account_id` text,
	`org_login` text,
	`scan_path` text,
	`auto_place_group_id` text,
	`last_synced_at` text,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `board_sources_board_id_idx` ON `board_sources` (`board_id`);--> statement-breakpoint
CREATE TABLE `boards` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repos` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`account_id` text,
	`github_id` integer,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`full_name` text NOT NULL,
	`description` text,
	`primary_language` text,
	`default_branch` text,
	`local_path` text,
	`topics` text DEFAULT '[]' NOT NULL,
	`last_synced_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `repos_full_name_idx` ON `repos` (`full_name`);--> statement-breakpoint
CREATE INDEX `repos_account_id_idx` ON `repos` (`account_id`);--> statement-breakpoint
CREATE INDEX `repos_source_idx` ON `repos` (`source`);