-- Adds an optional `address_pattern` column to the chains table. Used by
-- the renderer to validate contract addresses against the selected chain's
-- expected format (e.g. EVM `^0x[a-fA-F0-9]{40}$`, base58 for Solana, etc.).
--
-- Null is treated as "use the EVM default" at the renderer layer, so
-- existing rows continue to validate without a backfill UPDATE.

ALTER TABLE `chains` ADD COLUMN `address_pattern` text;
