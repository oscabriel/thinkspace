CREATE TABLE `workspace_provider_key` (
	`created_at` integer NOT NULL,
	`provider` text NOT NULL,
	`workspace_id` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `provider`)
);
