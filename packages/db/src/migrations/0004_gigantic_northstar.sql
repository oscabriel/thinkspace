CREATE TABLE `jwks` (
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer,
	`id` text PRIMARY KEY NOT NULL,
	`private_key` text NOT NULL,
	`public_key` text NOT NULL
);
