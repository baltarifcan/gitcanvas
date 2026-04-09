-- Adds the `chains` table that backs the smart contract explorer link
-- feature. Each row maps a chain name (as the user types it on annotations)
-- to a URL template with `{address}` as the substitution placeholder.
--
-- Default chains are seeded post-migration in `client.ts`, not via SQL,
-- because we want stable ULID ids that come from the same generator the
-- rest of the app uses.

CREATE TABLE `chains` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `explorer_url_template` text NOT NULL,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chains_name_unique` ON `chains` (`name`);
--> statement-breakpoint
CREATE INDEX `chains_name_idx` ON `chains` (`name`);
